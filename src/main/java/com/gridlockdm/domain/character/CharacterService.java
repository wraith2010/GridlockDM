package com.gridlockdm.domain.character;

import com.gridlockdm.common.GlobalExceptionHandler.ForbiddenException;
import com.gridlockdm.common.GlobalExceptionHandler.ResourceNotFoundException;
import com.gridlockdm.domain.user.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class CharacterService {

    private final CharacterRepository   characterRepo;
    private final DdbImportService      ddbImportService;
    private final PdfImportService      pdfImportService;

    // ── List / get ────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Character> getMyCharacters(UUID ownerId) {
        return characterRepo.findByOwnerIdOrderByUpdatedAtDesc(ownerId);
    }

    @Transactional(readOnly = true)
    public Character getCharacter(UUID id, UUID ownerId) {
        return characterRepo.findByIdAndOwnerId(id, ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("Character not found: " + id));
    }

    // ── Import: D&D Beyond API ────────────────────────────────────────────────

    @Transactional
    public Character importFromDdb(String shareLink, User owner) {
        String characterId = ddbImportService.extractCharacterId(shareLink);

        // Prevent duplicate imports — re-sync if already imported
        if (characterRepo.existsByOwnerIdAndDdbCharacterId(owner.getId(), characterId)) {
            Character existing = characterRepo.findByOwnerIdOrderByUpdatedAtDesc(owner.getId())
                    .stream()
                    .filter(c -> characterId.equals(c.getDdbCharacterId()))
                    .findFirst()
                    .orElseThrow();
            return syncFromDdb(existing, shareLink);
        }

        Character character = ddbImportService.fetchAndMap(shareLink, owner);
        characterRepo.save(character);
        log.info("Imported DDB character {} for user {}", characterId, owner.getEmail());
        return character;
    }

    /** Re-fetch from DDB and update an existing character record. */
    @Transactional
    public Character syncFromDdb(Character existing, String shareLink) {
        ddbImportService.updateFromDdb(existing, shareLink);
        existing.setUpdatedAt(java.time.Instant.now());
        characterRepo.save(existing);
        log.info("Synced DDB character {}", existing.getDdbCharacterId());
        return existing;
    }

    // ── Import: PDF ───────────────────────────────────────────────────────────

    @Transactional
    public Character importFromPdf(MultipartFile pdf, User owner) {
        Character character = pdfImportService.parseAndMap(pdf, owner);
        characterRepo.save(character);
        log.info("Imported PDF character '{}' for user {}", character.getName(), owner.getEmail());
        return character;
    }

    // ── Manual create ─────────────────────────────────────────────────────────

    @Transactional
    public Character createManual(CharacterDto dto, User owner) {
        Character character = dto.toEntity(owner);
        characterRepo.save(character);
        log.info("Created manual character '{}' for user {}", character.getName(), owner.getEmail());
        return character;
    }

    // ── Update ────────────────────────────────────────────────────────────────

    @Transactional
    public Character update(UUID id, CharacterDto dto, User owner) {
        Character character = requireOwned(id, owner.getId());
        dto.applyTo(character);
        character.setUpdatedAt(java.time.Instant.now());
        characterRepo.save(character);
        return character;
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    @Transactional
    public void delete(UUID id, User owner) {
        Character character = requireOwned(id, owner.getId());
        characterRepo.delete(character);
        log.info("Deleted character {} (owner={})", id, owner.getEmail());
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private Character requireOwned(UUID id, UUID ownerId) {
        return characterRepo.findByIdAndOwnerId(id, ownerId)
                .orElseThrow(() -> new ForbiddenException(
                        "Character not found or not owned by you: " + id));
    }
}
