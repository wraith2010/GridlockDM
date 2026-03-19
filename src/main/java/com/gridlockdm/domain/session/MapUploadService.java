package com.gridlockdm.domain.session;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class MapUploadService {

    private static final Logger log = LoggerFactory.getLogger(MapUploadService.class);

    private static final Set<String> ALLOWED_TYPES = Set.of(
            "image/jpeg", "image/png", "image/webp", "image/gif");

    private static final int DEFAULT_CELL_PX = 50;

    @Value("${gridlock.uploads.map-dir:./uploads/maps}")
    private String uploadDir;

    @Value("${gridlock.uploads.map-url-prefix:/uploads/maps}")
    private String urlPrefix;

    /**
     * Validates, saves the image, and derives a default grid config from its dimensions.
     * Returns the public URL path and the computed grid config.
     */
    public UploadResult store(MultipartFile file) throws IOException {
        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED_TYPES.contains(contentType)) {
            throw new IllegalArgumentException(
                    "Unsupported file type. Please upload a JPEG, PNG, WebP, or GIF.");
        }

        String ext = switch (contentType) {
            case "image/jpeg" -> ".jpg";
            case "image/png"  -> ".png";
            case "image/webp" -> ".webp";
            case "image/gif"  -> ".gif";
            default           -> ".img";
        };

        Path dir = Paths.get(uploadDir);
        Files.createDirectories(dir);

        String filename = UUID.randomUUID() + ext;
        Path   dest     = dir.resolve(filename).toAbsolutePath();
        file.transferTo(dest);
        log.info("Map image saved: {}", dest);

        Map<String, Object> gridConfig = defaultGridConfig(dest);
        String url = urlPrefix + "/" + filename;
        return new UploadResult(url, gridConfig);
    }

    private Map<String, Object> defaultGridConfig(Path imagePath) {
        try {
            BufferedImage img = ImageIO.read(imagePath.toFile());
            if (img == null) return null;

            int cols = Math.max(1, img.getWidth()  / DEFAULT_CELL_PX);
            int rows = Math.max(1, img.getHeight() / DEFAULT_CELL_PX);

            return Map.of(
                    "originX",    0,
                    "originY",    0,
                    "cellSizePx", DEFAULT_CELL_PX,
                    "cols",       cols,
                    "rows",       rows,
                    "confidence", 0.0
            );
        } catch (IOException e) {
            log.warn("Could not read image dimensions for grid config: {}", e.getMessage());
            return null;
        }
    }

    public record UploadResult(String url, Map<String, Object> gridConfig) {}
}
