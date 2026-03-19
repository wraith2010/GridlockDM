package com.gridlockdm.domain.session;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface SessionRepository extends JpaRepository<Session, UUID> {

    Optional<Session> findByInviteCode(String inviteCode);

    List<Session> findByDmIdOrderByCreatedAtDesc(UUID dmId);

    boolean existsByInviteCode(String inviteCode);
}
