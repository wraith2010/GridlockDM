package com.gridlockdm.domain.character;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gridlockdm.domain.user.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.time.Duration;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Fetches character data from D&D Beyond.
 *
 * Accepts either a share link or a bare character ID:
 *   https://www.dndbeyond.com/characters/123140741/QEJoax  (shared — private characters)
 *   https://www.dndbeyond.com/characters/123140741          (public character URL)
 *   123140741                                                (bare numeric ID)
 *
 * Strategy:
 *  1. Parse the input to extract characterId and optional shareKey.
 *  2. If a shareKey is present, try the character service API with Bearer auth.
 *  3. Fall back to the public JSON endpoint for characters without a share key
 *     or if the character service call fails.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DdbImportService {

    private static final Pattern SHARE_LINK_PATTERN =
            Pattern.compile(".*/characters/(\\d+)(?:/([A-Za-z0-9_=-]+))?.*");

    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper      objectMapper;

    @Value("${gridlock.ddb.character-api-base}")
    private String ddbApiBase;

    @Value("${gridlock.ddb.character-service-base}")
    private String characterServiceBase;

    @Value("${gridlock.ddb.request-timeout-ms}")
    private long timeoutMs;

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Parse the share link/ID, fetch character data, and map it to a Character.
     * @param shareLink full share URL or bare character ID
     */
    public Character fetchAndMap(String shareLink, User owner) {
        ParsedDdbLink parsed = parseLink(shareLink);
        Map<String, Object> raw = fetchRaw(parsed.characterId(), parsed.shareKey());
        Character character = mapToCharacter(raw, owner);
        character.setDdbCharacterId(parsed.characterId());
        character.setImportSource(Character.ImportSource.DDB_API);
        character.setRawSource(raw);
        return character;
    }

    public void updateFromDdb(Character existing, String shareLink) {
        ParsedDdbLink parsed = parseLink(shareLink);
        Map<String, Object> raw = fetchRaw(parsed.characterId(), parsed.shareKey());
        mapToCharacter(raw, existing);
        existing.setRawSource(raw);
    }

    /**
     * Extract the numeric character ID from a share link or bare ID string.
     * Useful for deduplication checks without fetching.
     */
    public String extractCharacterId(String shareLink) {
        return parseLink(shareLink).characterId();
    }

    // ── Link parsing ──────────────────────────────────────────────────────────

    public record ParsedDdbLink(String characterId, String shareKey) {}

    public static ParsedDdbLink parseLink(String input) {
        if (input == null || input.isBlank()) {
            throw new DdbImportException("Please enter a D&D Beyond share link or character ID.", null);
        }
        String trimmed = input.trim();

        // Bare numeric ID
        if (trimmed.matches("\\d+")) {
            return new ParsedDdbLink(trimmed, null);
        }

        // Full or partial URL: /characters/{id} or /characters/{id}/{shareKey}
        Matcher m = SHARE_LINK_PATTERN.matcher(trimmed);
        if (m.matches()) {
            return new ParsedDdbLink(m.group(1), m.group(2)); // group(2) may be null
        }

        throw new DdbImportException(
                "Unrecognised format. Paste a D&D Beyond share link " +
                "(e.g. dndbeyond.com/characters/123456789/AbCdEf) or just the numeric character ID.", null);
    }

    // ── Private: HTTP fetch ───────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private Map<String, Object> fetchRaw(String characterId, String shareKey) {
        // Prefer character-service with share token; fall back to public JSON endpoint
        if (shareKey != null && !shareKey.isBlank()) {
            try {
                return fetchFromCharacterService(characterId, shareKey);
            } catch (DdbCharacterNotFoundException e) {
                throw e;
            } catch (Exception e) {
                log.warn("Character service fetch failed for {}, falling back to public endpoint: {}",
                        characterId, e.getMessage());
            }
        }
        return fetchFromPublicEndpoint(characterId);
    }

    private Map<String, Object> fetchFromCharacterService(String characterId, String shareKey) {
        String url = characterServiceBase + "/" + characterId;
        log.info("Fetching DDB character from character service: {}", url);

        try {
            String json = webClientBuilder.build()
                    .get()
                    .uri(url)
                    .header("Authorization", "Bearer " + shareKey)
                    .header("User-Agent", "GridlockDM/1.0")
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofMillis(timeoutMs))
                    .block();

            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});

        } catch (WebClientResponseException.NotFound e) {
            throw new DdbCharacterNotFoundException(
                    "Character " + characterId + " not found. Check that the share link is correct.");
        } catch (WebClientResponseException e) {
            throw new DdbImportException(
                    "D&D Beyond character service returned an error: " + e.getStatusCode(), e);
        } catch (Exception e) {
            throw new DdbImportException(
                    "Failed to fetch character from D&D Beyond: " + e.getMessage(), e);
        }
    }

    private Map<String, Object> fetchFromPublicEndpoint(String characterId) {
        String url = ddbApiBase + "/" + characterId + "/json";
        log.info("Fetching DDB character from public endpoint: {}", url);

        try {
            String json = webClientBuilder.build()
                    .get()
                    .uri(url)
                    .header("User-Agent", "GridlockDM/1.0")
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofMillis(timeoutMs))
                    .block();

            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});

        } catch (WebClientResponseException.NotFound e) {
            throw new DdbCharacterNotFoundException(
                    "Character " + characterId + " not found on D&D Beyond. " +
                    "Make sure the character exists and use a share link for private characters.");
        } catch (WebClientResponseException e) {
            if (e.getStatusCode().value() == 500) {
                throw new DdbCharacterNotFoundException(
                        "Could not access character " + characterId + " — it may be set to private. " +
                        "Use the D&D Beyond share link (Manage → Share) to import private characters.");
            }
            throw new DdbImportException("D&D Beyond returned an error: " + e.getStatusCode(), e);
        } catch (Exception e) {
            throw new DdbImportException("Failed to import from D&D Beyond: " + e.getMessage(), e);
        }
    }

    // ── Private: field mapping ────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private Character mapToCharacter(Map<String, Object> raw, User owner) {
        Character character = Character.builder().owner(owner).build();
        mapToCharacter(raw, character);
        return character;
    }

    @SuppressWarnings("unchecked")
    private void mapToCharacter(Map<String, Object> raw, Character character) {
        Map<String, Object> data = (Map<String, Object>) raw.get("data");
        if (data == null) {
            throw new DdbImportException("Unexpected DDB response format — 'data' field missing", null);
        }

        // ── Identity ──────────────────────────────────────────────────────────
        character.setName(stringVal(data, "name", "Unknown Adventurer"));

        Object raceObj = data.get("race");
        if (raceObj instanceof Map<?,?> raceMap) {
            character.setRace(stringVal((Map<String, Object>) raceMap, "fullName", null));
        } else if (raceObj instanceof String s) {
            character.setRace(s);
        }

        Object classesObj = data.get("classes");
        if (classesObj instanceof java.util.List<?> classes && !classes.isEmpty()) {
            StringBuilder className = new StringBuilder();
            int totalLevel = 0;
            for (Object cls : classes) {
                if (cls instanceof Map<?,?> clsMap) {
                    Map<String, Object> clsData = (Map<String, Object>) clsMap;
                    Object def = clsData.get("definition");
                    if (def instanceof Map<?,?> defMap) {
                        String name = stringVal((Map<String, Object>) defMap, "name", "?");
                        int lvl = intVal(clsData, "level", 0);
                        if (!className.isEmpty()) className.append(" / ");
                        className.append(name);
                        totalLevel += lvl;
                    }
                }
            }
            character.setClassName(className.toString());
            character.setLevel(totalLevel > 0 ? totalLevel : 1);
        }

        character.setBackground(extractBackground(data));

        // ── Stats ─────────────────────────────────────────────────────────────
        character.setMaxHp(extractMaxHp(data));
        character.setCurrentHp(extractCurrentHp(data));
        character.setArmorClass(extractAc(data));
        character.setSpeed(extractSpeed(data));

        // ── Ability scores ────────────────────────────────────────────────────
        extractAbilities(data, character);

        // ── Proficiency bonus ─────────────────────────────────────────────────
        int level = character.getLevel() != null ? character.getLevel() : 1;
        character.setProficiencyBonus(proficiencyBonusForLevel(level));

        // ── Avatar ────────────────────────────────────────────────────────────
        Object avatarObj = data.get("avatarUrl");
        if (avatarObj instanceof String avatarUrl && !avatarUrl.isBlank()) {
            character.setAvatarUrl(avatarUrl);
        }
    }

    // ── Field extractors ──────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private Integer extractMaxHp(Map<String, Object> data) {
        Object hpObj = data.get("baseHitPoints");
        if (hpObj instanceof Number n) return n.intValue();

        Object statsObj = data.get("hitPointInfo");
        if (statsObj instanceof Map<?,?> hpMap) {
            return intVal((Map<String, Object>) hpMap, "maximumHitPoints", null);
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private Integer extractCurrentHp(Map<String, Object> data) {
        Object removed = data.get("removedHitPoints");
        Integer max = extractMaxHp(data);
        if (max != null && removed instanceof Number n) {
            return max - n.intValue();
        }
        return max;
    }

    @SuppressWarnings("unchecked")
    private Integer extractAc(Map<String, Object> data) {
        Object acObj = data.get("armorClass");
        if (acObj instanceof Number n) return n.intValue();
        return null;
    }

    @SuppressWarnings("unchecked")
    private Integer extractSpeed(Map<String, Object> data) {
        Object speedObj = data.get("overrideSpeed");
        if (speedObj instanceof Number n && n.intValue() > 0) return n.intValue();

        Object racialSpeeds = data.get("race");
        if (racialSpeeds instanceof Map<?,?> raceMap) {
            Object baseSpeed = ((Map<?,?>) raceMap).get("weightSpeeds");
            if (baseSpeed instanceof Map<?,?> speedMap) {
                Object normal = speedMap.get("normal");
                if (normal instanceof Map<?,?> normalMap) {
                    Object walk = normalMap.get("walk");
                    if (walk instanceof Number wn) return wn.intValue();
                }
            }
        }
        return 30;
    }

    @SuppressWarnings("unchecked")
    private String extractBackground(Map<String, Object> data) {
        Object bgObj = data.get("background");
        if (bgObj instanceof Map<?,?> bgMap) {
            Object def = bgMap.get("definition");
            if (def instanceof Map<?,?> defMap) {
                return stringVal((Map<String, Object>) defMap, "name", null);
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private void extractAbilities(Map<String, Object> data, Character character) {
        Object statsObj = data.get("stats");
        if (!(statsObj instanceof java.util.List<?> stats)) return;

        for (Object statObj : stats) {
            if (!(statObj instanceof Map<?,?> stat)) continue;
            int id    = intVal((Map<String, Object>) stat, "id", 0);
            int value = intVal((Map<String, Object>) stat, "value", 10);
            switch (id) {
                case 1 -> character.setStrength(value);
                case 2 -> character.setDexterity(value);
                case 3 -> character.setConstitution(value);
                case 4 -> character.setIntelligence(value);
                case 5 -> character.setWisdom(value);
                case 6 -> character.setCharisma(value);
            }
        }
    }

    // ── Utility ───────────────────────────────────────────────────────────────

    private String stringVal(Map<String, Object> map, String key, String defaultVal) {
        Object val = map.get(key);
        return val instanceof String s ? s : defaultVal;
    }

    private Integer intVal(Map<String, Object> map, String key, Integer defaultVal) {
        Object val = map.get(key);
        return val instanceof Number n ? n.intValue() : defaultVal;
    }

    private int proficiencyBonusForLevel(int level) {
        return 2 + ((level - 1) / 4);
    }

    // ── Exceptions ────────────────────────────────────────────────────────────

    public static class DdbCharacterNotFoundException extends RuntimeException {
        public DdbCharacterNotFoundException(String message) { super(message); }
    }

    public static class DdbImportException extends RuntimeException {
        public DdbImportException(String message, Throwable cause) { super(message, cause); }
    }
}
