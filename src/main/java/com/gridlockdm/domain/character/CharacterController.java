package com.gridlockdm.domain.character;

import com.gridlockdm.domain.user.User;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/characters")
@RequiredArgsConstructor
public class CharacterController {

    private final CharacterService characterService;

    /** GET /api/characters — list my characters */
    @GetMapping
    public List<CharacterSummaryDto> list(@AuthenticationPrincipal User user) {
        return characterService.getMyCharacters(user.getId())
                .stream().map(CharacterSummaryDto::from).toList();
    }

    /** GET /api/characters/{id} — full character sheet */
    @GetMapping("/{id}")
    public CharacterDetailDto get(@PathVariable UUID id, @AuthenticationPrincipal User user) {
        return CharacterDetailDto.from(characterService.getCharacter(id, user.getId()));
    }

    /** POST /api/characters/manual — create character manually */
    @PostMapping("/manual")
    public ResponseEntity<CharacterDetailDto> createManual(
            @Valid @RequestBody CharacterDto dto,
            @AuthenticationPrincipal User user) {
        Character c = characterService.createManual(dto, user);
        return ResponseEntity.status(HttpStatus.CREATED).body(CharacterDetailDto.from(c));
    }

    /** POST /api/characters/import/ddb — import from D&D Beyond by character ID */
    @PostMapping("/import/ddb")
    public ResponseEntity<CharacterDetailDto> importDdb(
            @RequestBody DdbImportRequest req,
            @AuthenticationPrincipal User user) {
        Character c = characterService.importFromDdb(req.characterId(), user);
        return ResponseEntity.status(HttpStatus.CREATED).body(CharacterDetailDto.from(c));
    }

    /** POST /api/characters/import/pdf — upload a DDB PDF */
    @PostMapping(value = "/import/pdf", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<CharacterDetailDto> importPdf(
            @RequestParam("file") MultipartFile file,
            @AuthenticationPrincipal User user) {
        Character c = characterService.importFromPdf(file, user);
        return ResponseEntity.status(HttpStatus.CREATED).body(CharacterDetailDto.from(c));
    }

    /** PUT /api/characters/{id} — update a character */
    @PutMapping("/{id}")
    public CharacterDetailDto update(
            @PathVariable UUID id,
            @Valid @RequestBody CharacterDto dto,
            @AuthenticationPrincipal User user) {
        return CharacterDetailDto.from(characterService.update(id, dto, user));
    }

    /** DELETE /api/characters/{id} */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID id,
            @AuthenticationPrincipal User user) {
        characterService.delete(id, user);
        return ResponseEntity.noContent().build();
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record DdbImportRequest(String characterId) {}

    /** Lightweight card — used in character picker lists */
    public record CharacterSummaryDto(
            UUID    id,
            String  name,
            String  race,
            String  className,
            int     level,
            Integer maxHp,
            int     speed,
            String  avatarUrl,
            String  importSource,
            Instant updatedAt
    ) {
        static CharacterSummaryDto from(Character c) {
            return new CharacterSummaryDto(
                    c.getId(), c.getName(), c.getRace(), c.getClassName(),
                    c.getLevel(), c.getMaxHp(), c.effectiveSpeed(),
                    c.getAvatarUrl(), c.getImportSource().name(), c.getUpdatedAt());
        }
    }

    /** Full sheet — used in the character detail / edit view */
    public record CharacterDetailDto(
            UUID    id,
            String  name,
            String  race,
            String  className,
            String  subclass,
            int     level,
            String  background,
            Integer maxHp,
            Integer currentHp,
            Integer tempHp,
            Integer armorClass,
            int     speed,
            Integer flySpeed,
            Integer swimSpeed,
            Integer initiativeBonus,
            Integer proficiencyBonus,
            Integer strength,
            Integer dexterity,
            Integer constitution,
            Integer intelligence,
            Integer wisdom,
            Integer charisma,
            String  avatarUrl,
            String  importSource,
            String  ddbCharacterId,
            String  notes,
            Instant createdAt,
            Instant updatedAt
    ) {
        static CharacterDetailDto from(Character c) {
            return new CharacterDetailDto(
                    c.getId(), c.getName(), c.getRace(), c.getClassName(), c.getSubclass(),
                    c.getLevel(), c.getBackground(), c.getMaxHp(), c.getCurrentHp(), c.getTempHp(),
                    c.getArmorClass(), c.effectiveSpeed(), c.getFlySpeed(), c.getSwimSpeed(),
                    c.getInitiativeBonus(), c.getProficiencyBonus(), c.getStrength(), c.getDexterity(),
                    c.getConstitution(), c.getIntelligence(), c.getWisdom(), c.getCharisma(),
                    c.getAvatarUrl(), c.getImportSource().name(), c.getDdbCharacterId(),
                    c.getNotes(), c.getCreatedAt(), c.getUpdatedAt());
        }
    }
}
