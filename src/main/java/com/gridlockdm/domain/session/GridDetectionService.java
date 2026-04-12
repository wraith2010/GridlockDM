package com.gridlockdm.domain.session;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.awt.image.ConvolveOp;
import java.awt.image.Kernel;
import java.awt.image.RescaleOp;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Calls the Claude API to detect grid lines in a battle map image.
 * Returns a gridConfig map compatible with the Session.gridConfig field.
 * Falls back to null if the API key is not configured or detection fails.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GridDetectionService {

    @Value("${gridlock.anthropic.api-key:}")
    private String apiKey;

    private final ObjectMapper objectMapper;

    /** Matches grid-size hints in filenames like "map_72x21.jpg", "dungeon 24x18.png", "grid40x30". */
    private static final Pattern FILENAME_GRID_PATTERN =
            Pattern.compile("(?<!\\d)(\\d{1,3})\\s*[xX]\\s*(\\d{1,3})(?!\\d)");

    private static final String PROMPT_WITH_HINT = """
        Analyze this tabletop RPG battle map image.
        The filename is: %s
        The filename indicates the grid is %d columns by %d rows. TRUST THIS — do not recount.
        Your ONLY job is to measure the four margins (in pixels) from each image edge
        to the first/last grid line.

        Grid lines may be subtle (white, light gray, dark gray). Look along each edge
        for where the grid actually begins and ends — there is often a decorative
        border or blank margin.

        Return ONLY this JSON, with the cols and rows values I gave you:
        {
          "hasGrid": true,
          "marginLeft": <int px>,
          "marginRight": <int px>,
          "marginTop": <int px>,
          "marginBottom": <int px>,
          "cols": %d,
          "rows": %d,
          "confidence": <0.0 to 1.0 for margin accuracy>
        }

        If you genuinely cannot see any grid lines at all:
        {"hasGrid":false,"marginLeft":0,"marginRight":0,"marginTop":0,"marginBottom":0,"cols":%d,"rows":%d,"confidence":0.0}
        """;

    private static final String PROMPT_NO_HINT = """
        Analyze this tabletop RPG battle map image and detect the grid overlay.
        A grid consists of evenly-spaced horizontal and vertical lines.
        Grid lines are often subtle — white, light gray, dark gray, or slightly different from the background.
        Look carefully along all four edges for where the grid begins and ends.
        Columns and rows are almost never equal in count.

        The filename provided is: %s (no grid size hint detected).

        The image may have a decorative border or blank margin before the first grid line.
        Measure the margin (in pixels) on each side: the distance from the image edge to the nearest grid line.
        Also count the number of complete grid columns (left-to-right) and rows (top-to-bottom).

        Return ONLY a JSON object with no other text:
        {
          "hasGrid": true,
          "marginLeft": 12,
          "marginRight": 8,
          "marginTop": 10,
          "marginBottom": 6,
          "cols": 24,
          "rows": 18,
          "confidence": 0.92
        }

        Fields:
        - hasGrid: boolean — is there a visible grid?
        - marginLeft: pixels from the LEFT image edge to the first vertical grid line
        - marginRight: pixels from the RIGHT image edge to the last vertical grid line
        - marginTop: pixels from the TOP image edge to the first horizontal grid line
        - marginBottom: pixels from the BOTTOM image edge to the last horizontal grid line
        - cols: number of grid columns (vertical divisions)
        - rows: number of grid rows (horizontal divisions)
        - confidence: 0.0 to 1.0 — your certainty

        If there is no grid: {"hasGrid":false,"marginLeft":0,"marginRight":0,"marginTop":0,"marginBottom":0,"cols":20,"rows":15,"confidence":0.0}
        """;

    /** Extract [cols, rows] from a filename if it contains a recognizable NxM pattern. */
    static int[] parseGridFromFilename(String filename) {
        if (filename == null) return null;
        Matcher m = FILENAME_GRID_PATTERN.matcher(filename);
        int[] last = null;
        // Take the LAST match — the convention is dimensions at the end of the name
        while (m.find()) {
            int cols = Integer.parseInt(m.group(1));
            int rows = Integer.parseInt(m.group(2));
            if (cols >= 2 && cols <= 200 && rows >= 2 && rows <= 200) {
                last = new int[]{cols, rows};
            }
        }
        return last;
    }

    /**
     * Detect grid from an image file.
     *
     * @param imagePath   path to the saved image
     * @param contentType MIME type (image/jpeg, image/png, etc.)
     * @return gridConfig map, or null if detection is unavailable/failed
     */
    public Map<String, Object> detectGrid(Path imagePath, String contentType) {
        if (apiKey == null || apiKey.isBlank()) {
            log.debug("Anthropic API key not configured — skipping grid detection");
            return null;
        }

        try {
            BufferedImage raw = ImageIO.read(imagePath.toFile());
            if (raw == null) {
                log.warn("Could not read image for grid detection: {}", imagePath);
                return null;
            }

            byte[] processed = encodeProcessed(raw);
            writeDebugImage(imagePath, processed);
            String base64   = Base64.getEncoder().encodeToString(processed);
            String filename = imagePath.getFileName().toString();
            int[]  hinted   = parseGridFromFilename(filename);
            String prompt   = hinted != null
                    ? String.format(PROMPT_WITH_HINT, filename, hinted[0], hinted[1], hinted[0], hinted[1], hinted[0], hinted[1])
                    : String.format(PROMPT_NO_HINT, filename);

            RestClient client = RestClient.builder()
                    .baseUrl("https://api.anthropic.com")
                    .build();

            Map<String, Object> body = Map.of(
                    "model",      "claude-opus-4-6",
                    "max_tokens", 512,
                    "messages", List.of(Map.of(
                            "role", "user",
                            "content", List.of(
                                    Map.of("type", "image",
                                           "source", Map.of(
                                                   "type",       "base64",
                                                   "media_type", "image/png",
                                                   "data",       base64)),
                                    Map.of("type", "text", "text", prompt)
                            )
                    ))
            );

            String responseJson = client.post()
                    .uri("/v1/messages")
                    .header("x-api-key", apiKey)
                    .header("anthropic-version", "2023-06-01")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(String.class);

            return parseResponse(responseJson, raw.getWidth(), raw.getHeight());

        } catch (Exception e) {
            log.warn("Grid detection failed ({}), falling back to default", e.getMessage());
            return null;
        }
    }

    /**
     * Sharpen and boost contrast so subtle grid lines stand out more clearly
     * before sending to the vision API. Always outputs PNG for lossless encoding.
     */
    private byte[] encodeProcessed(BufferedImage src) throws IOException {
        // Convert to grayscale — grid lines are almost always low-chroma (white/gray/black),
        // so removing color distractions improves signal-to-noise for the vision model.
        BufferedImage gray = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_BYTE_GRAY);
        Graphics2D g = gray.createGraphics();
        g.drawImage(src, 0, 0, null);
        g.dispose();

        // Sharpen: makes 1-2px grid lines crisper against textured backgrounds
        float[] sharpenKernel = { 0, -1, 0, -1, 5, -1, 0, -1, 0 };
        BufferedImage sharpened = new ConvolveOp(
                new Kernel(3, 3, sharpenKernel), ConvolveOp.EDGE_NO_OP, null).filter(gray, null);

        // Contrast boost: helps subtle lines stand out from background noise
        BufferedImage enhanced = new RescaleOp(1.2f, 15f, null).filter(sharpened, null);

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(enhanced, "png", baos);
        return baos.toByteArray();
    }

    /**
     * Write the preprocessed image sent to Claude alongside the original, for debugging.
     * Suffix: .debug.png. Failures are logged but do not interrupt detection.
     */
    private void writeDebugImage(Path originalPath, byte[] pngBytes) {
        try {
            String name      = originalPath.getFileName().toString();
            int    dot       = name.lastIndexOf('.');
            String base      = dot > 0 ? name.substring(0, dot) : name;
            Path   debugPath = originalPath.resolveSibling(base + ".debug.png");
            java.nio.file.Files.write(debugPath, pngBytes);
            log.info("Grid detection debug image written: {}", debugPath);
        } catch (IOException e) {
            log.warn("Could not write grid detection debug image: {}", e.getMessage());
        }
    }

    private Map<String, Object> parseResponse(String responseJson, int imgW, int imgH) throws Exception {
        JsonNode root    = objectMapper.readTree(responseJson);
        String   text    = root.path("content").get(0).path("text").asText();

        int start = text.indexOf('{');
        int end   = text.lastIndexOf('}') + 1;
        if (start < 0 || end <= start) {
            log.warn("Claude returned no JSON in grid detection response");
            return null;
        }

        JsonNode node         = objectMapper.readTree(text.substring(start, end));
        boolean  hasGrid      = node.path("hasGrid").asBoolean(false);
        int      marginLeft   = node.path("marginLeft").asInt(0);
        int      marginRight  = node.path("marginRight").asInt(0);
        int      marginTop    = node.path("marginTop").asInt(0);
        int      marginBottom = node.path("marginBottom").asInt(0);
        double   confidence   = node.path("confidence").asDouble(0.0);

        int effectiveW = Math.max(1, imgW - marginLeft - marginRight);
        int effectiveH = Math.max(1, imgH - marginTop  - marginBottom);
        int cols = node.has("cols") ? node.path("cols").asInt(1) : Math.max(1, effectiveW / 50);
        int rows = node.has("rows") ? node.path("rows").asInt(1) : Math.max(1, effectiveH / 50);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("marginLeft",   marginLeft);
        result.put("marginRight",  marginRight);
        result.put("marginTop",    marginTop);
        result.put("marginBottom", marginBottom);
        result.put("cols",         Math.max(1, cols));
        result.put("rows",         Math.max(1, rows));
        result.put("confidence",   hasGrid ? confidence : 0.0);

        log.info("Grid detected: hasGrid={} confidence={} margins=({},{},{},{}) grid={}x{}",
                hasGrid, confidence, marginLeft, marginTop, marginRight, marginBottom, cols, rows);
        return result;
    }
}
