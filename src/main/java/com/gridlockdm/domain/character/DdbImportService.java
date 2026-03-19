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

/**
 * Fetches character data from the D&D Beyond public character JSON endpoint.
 *
 * Endpoint: GET https://www.dndbeyond.com/character/{characterId}/json
 *
 * This endpoint is publicly accessible for characters set to public visibility.
 * The response is a large JSON blob — we extract the fields we care about and
 * store the full blob in raw_source for future re-syncs.
 *
 * NOTE: D&D Beyond has not published an official API. This uses their
 * unofficial public endpoint. If they add auth requirements in the future,
 * players will need to supply a token or fall back to PDF import.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DdbImportService {

    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper      objectMapper;

    @Value("${gridlock.ddb.character-api-base}")
    private String ddbApiBase;

    @Value("${gridlock.ddb.request-timeout-ms}")
    private long timeoutMs;

    // ── Public API ────────────────────────────────────────────────────────────

    public Character fetchAndMap(String ddbCharacterId, User owner) {
        Map<String, Object> raw = fetchRaw(ddbCharacterId);
        Character character = mapToCharacter(raw, owner);
        character.setDdbCharacterId(ddbCharacterId);
        character.setImportSource(Character.ImportSource.DDB_API);
        character.setRawSource(raw);
        return character;
    }

    public void updateFromDdb(Character existing, String ddbCharacterId) {
        Map<String, Object> raw = fetchRaw(ddbCharacterId);
        mapToCharacter(raw, existing);
        existing.setRawSource(raw);
    }

    // ── Private: HTTP fetch ───────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private Map<String, Object> fetchRaw(String ddbCharacterId) {
        String url = ddbApiBase + "/" + ddbCharacterId + "/json";
        log.info("Fetching DDB character from {}", url);

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
                    "Character " + ddbCharacterId + " not found on D&D Beyond. " +
                    "Make sure the character is set to public visibility.");
        } catch (WebClientResponseException e) {
            throw new DdbImportException("D&D Beyond returned an error: " + e.getStatusCode(), e);
        } catch (Exception e) {
            throw new DdbImportException("Failed to import from D&D Beyond: " + e.getMessage(), e);
        }
    }

    // ── Private: field mapping ────────────────────────────────────────────────

    /**
     * Maps the DDB JSON blob to a new Character entity.
     * DDB's JSON structure: { data: { name, race, classes: [...], ... } }
     */
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

        // Race — can be a nested object or a string depending on DDB version
        Object raceObj = data.get("race");
        if (raceObj instanceof Map<?,?> raceMap) {
            character.setRace(stringVal((Map<String, Object>) raceMap, "fullName", null));
        } else if (raceObj instanceof String s) {
            character.setRace(s);
        }

        // Classes — DDB supports multiclass; we join them for display
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

        // ── Proficiency bonus (derived from total level, per 5e rules) ────────
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

        // Some DDB responses nest it differently
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
        // DDB computes AC server-side; it may appear in stats or overrides
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
        return 30; // D&D 5e default
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

        // DDB stat IDs: 1=STR, 2=DEX, 3=CON, 4=INT, 5=WIS, 6=CHA
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
        return 2 + ((level - 1) / 4);   // 5e formula: +2 at 1-4, +3 at 5-8, etc.
    }

    // ── Exceptions ────────────────────────────────────────────────────────────

    public static class DdbCharacterNotFoundException extends RuntimeException {
        public DdbCharacterNotFoundException(String message) { super(message); }
    }

    public static class DdbImportException extends RuntimeException {
        public DdbImportException(String message, Throwable cause) { super(message, cause); }
    }
}
