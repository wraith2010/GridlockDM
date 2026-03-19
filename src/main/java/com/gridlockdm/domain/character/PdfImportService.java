package com.gridlockdm.domain.character;

import com.gridlockdm.domain.user.User;
import lombok.extern.slf4j.Slf4j;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.interactive.form.PDAcroForm;
import org.apache.pdfbox.pdmodel.interactive.form.PDField;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * Parses a D&D Beyond exported character sheet PDF.
 *
 * DDB exports form-fillable PDFs with consistent field names.
 * We use PDFBox to read the AcroForm fields and map them to
 * our Character entity.
 *
 * Field names were mapped by inspecting DDB PDF exports.
 * If DDB changes their PDF structure, update the constants below.
 */
@Slf4j
@Service
public class PdfImportService {

    // ── DDB PDF AcroForm field names ──────────────────────────────────────────

    // Identity
    private static final String F_NAME        = "CharacterName";
    private static final String F_CLASS_LEVEL = "ClassLevel";
    private static final String F_RACE        = "Race";
    private static final String F_BACKGROUND  = "Background";

    // Combat
    private static final String F_AC          = "AC";
    private static final String F_HP_MAX      = "HPMax";
    private static final String F_HP_CURRENT  = "HPCurrent";
    private static final String F_HP_TEMP     = "HPTemp";
    private static final String F_SPEED       = "Speed";
    private static final String F_INIT        = "Initiative";
    private static final String F_PROF_BONUS  = "ProfBonus";

    // Ability scores
    private static final String F_STR         = "STR";
    private static final String F_DEX         = "DEX";
    private static final String F_CON         = "CON";
    private static final String F_INT         = "INT";
    private static final String F_WIS         = "WIS";
    private static final String F_CHA         = "CHA";

    // ── Public API ────────────────────────────────────────────────────────────

    public Character parseAndMap(MultipartFile pdf, User owner) {
        validateFile(pdf);

        try (PDDocument doc = Loader.loadPDF(pdf.getBytes())) {
            PDAcroForm form = doc.getDocumentCatalog().getAcroForm();
            if (form == null) {
                throw new PdfParseException(
                        "This PDF has no form fields. Please use the official D&D Beyond PDF export.");
            }

            Map<String, String> fields = extractFields(form);
            log.debug("Extracted {} PDF fields from character sheet", fields.size());

            return buildCharacter(fields, owner, pdf.getOriginalFilename());

        } catch (IOException e) {
            throw new PdfParseException("Could not read PDF file: " + e.getMessage());
        }
    }

    // ── Private: field extraction ─────────────────────────────────────────────

    private Map<String, String> extractFields(PDAcroForm form) {
        Map<String, String> values = new HashMap<>();
        for (PDField field : form.getFieldTree()) {
            String name  = field.getFullyQualifiedName();
            String value = field.getValueAsString();
            if (name != null && value != null && !value.isBlank()) {
                values.put(name, value.strip());
            }
        }
        return values;
    }

    // ── Private: entity construction ──────────────────────────────────────────

    private Character buildCharacter(Map<String, String> f, User owner, String filename) {
        Character.CharacterBuilder builder = Character.builder()
                .owner(owner)
                .importSource(Character.ImportSource.PDF)
                .rawSource(toRawSource(f));

        // ── Identity ──────────────────────────────────────────────────────────
        String name = f.getOrDefault(F_NAME, "").isBlank()
                ? (filename != null ? stripPdfExtension(filename) : "Imported Character")
                : f.get(F_NAME);
        builder.name(name);
        builder.race(f.get(F_RACE));
        builder.background(f.get(F_BACKGROUND));

        // DDB exports "Fighter 5 / Rogue 2" style — parse class and level separately
        String classLevel = f.get(F_CLASS_LEVEL);
        if (classLevel != null) {
            ClassLevelParse parsed = parseClassLevel(classLevel);
            builder.className(parsed.className());
            builder.level(parsed.level());
        }

        // ── Combat ────────────────────────────────────────────────────────────
        builder.armorClass(parseInt(f.get(F_AC)));
        builder.maxHp(parseInt(f.get(F_HP_MAX)));
        builder.currentHp(parseInt(f.get(F_HP_CURRENT)));
        builder.tempHp(parseIntOrZero(f.get(F_HP_TEMP)));
        builder.speed(parseSpeedFeet(f.get(F_SPEED)));
        builder.initiativeBonus(parseInt(f.get(F_INIT)));
        builder.proficiencyBonus(parseInt(f.get(F_PROF_BONUS)));

        // ── Abilities ─────────────────────────────────────────────────────────
        builder.strength(parseInt(f.get(F_STR)));
        builder.dexterity(parseInt(f.get(F_DEX)));
        builder.constitution(parseInt(f.get(F_CON)));
        builder.intelligence(parseInt(f.get(F_INT)));
        builder.wisdom(parseInt(f.get(F_WIS)));
        builder.charisma(parseInt(f.get(F_CHA)));

        Character character = builder.build();

        // Derive current HP from max if not explicitly set
        if (character.getCurrentHp() == null && character.getMaxHp() != null) {
            character.setCurrentHp(character.getMaxHp());
        }

        return character;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Parses "Fighter 5 / Rogue 2" or "Wizard 10" into class name + total level.
     */
    private ClassLevelParse parseClassLevel(String raw) {
        String[] parts = raw.split("/");
        StringBuilder className = new StringBuilder();
        int totalLevel = 0;

        for (String part : parts) {
            String trimmed = part.strip();
            // Matches "Fighter 5", "Rogue 2", etc.
            java.util.regex.Matcher m =
                    java.util.regex.Pattern.compile("^(.+?)\\s+(\\d+)$").matcher(trimmed);
            if (m.matches()) {
                if (!className.isEmpty()) className.append(" / ");
                className.append(m.group(1).strip());
                totalLevel += Integer.parseInt(m.group(2));
            } else {
                // Couldn't parse — just use the raw string
                if (!className.isEmpty()) className.append(" / ");
                className.append(trimmed);
            }
        }

        return new ClassLevelParse(
                className.isEmpty() ? raw : className.toString(),
                totalLevel > 0 ? totalLevel : 1);
    }

    /** Parses a speed string — "30 ft." → 30 */
    private Integer parseSpeedFeet(String raw) {
        if (raw == null || raw.isBlank()) return 30;
        String digits = raw.replaceAll("[^0-9]", "");
        if (digits.isBlank()) return 30;
        try { return Integer.parseInt(digits); }
        catch (NumberFormatException e) { return 30; }
    }

    private Integer parseInt(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try { return Integer.parseInt(raw.replaceAll("[^0-9\\-]", "")); }
        catch (NumberFormatException e) { return null; }
    }

    private int parseIntOrZero(String raw) {
        Integer val = parseInt(raw);
        return val != null ? val : 0;
    }

    private void validateFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new PdfParseException("No file provided");
        }
        String ct = file.getContentType();
        if (ct == null || !ct.equals("application/pdf")) {
            throw new PdfParseException("File must be a PDF (got: " + ct + ")");
        }
        if (file.getSize() > 20 * 1024 * 1024L) {
            throw new PdfParseException("PDF exceeds 20MB size limit");
        }
    }

    private String stripPdfExtension(String filename) {
        return filename.endsWith(".pdf")
                ? filename.substring(0, filename.length() - 4)
                : filename;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> toRawSource(Map<String, String> fields) {
        return (Map<String, Object>) (Map<?, ?>) fields;
    }

    private record ClassLevelParse(String className, int level) {}

    // ── Exceptions ────────────────────────────────────────────────────────────

    public static class PdfParseException extends RuntimeException {
        public PdfParseException(String message) { super(message); }
    }
}
