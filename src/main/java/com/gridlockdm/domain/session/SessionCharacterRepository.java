package com.gridlockdm.domain.session;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface SessionCharacterRepository extends JpaRepository<SessionCharacter, UUID> {

    List<SessionCharacter> findBySessionId(UUID sessionId);

    List<SessionCharacter> findBySessionIdAndActiveTrue(UUID sessionId);

    Optional<SessionCharacter> findBySessionIdAndPlayerId(UUID sessionId, UUID playerId);

    boolean existsBySessionIdAndCharacterId(UUID sessionId, UUID characterId);
}
