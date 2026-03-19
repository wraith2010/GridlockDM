package com.gridlockdm.domain.character;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface CharacterRepository extends JpaRepository<Character, UUID> {

    List<Character> findByOwnerIdOrderByUpdatedAtDesc(UUID ownerId);

    Optional<Character> findByIdAndOwnerId(UUID id, UUID ownerId);

    boolean existsByOwnerIdAndDdbCharacterId(UUID ownerId, String ddbCharacterId);
}
