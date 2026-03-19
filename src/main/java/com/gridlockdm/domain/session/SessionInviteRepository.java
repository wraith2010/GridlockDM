package com.gridlockdm.domain.session;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface SessionInviteRepository extends JpaRepository<SessionInvite, UUID> {

    List<SessionInvite> findBySessionIdAndStatus(UUID sessionId, SessionInvite.InviteStatus status);

    Optional<SessionInvite> findBySessionIdAndUserId(UUID sessionId, UUID userId);

    boolean existsBySessionIdAndUserIdAndStatus(
            UUID sessionId, UUID userId, SessionInvite.InviteStatus status);
}
