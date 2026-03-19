package com.gridlockdm.domain.session;

import com.gridlockdm.common.GlobalExceptionHandler.ForbiddenException;
import com.gridlockdm.common.GlobalExceptionHandler.ResourceNotFoundException;
import com.gridlockdm.common.InviteCodeGenerator;
import com.gridlockdm.config.JwtTokenProvider;
import com.gridlockdm.domain.character.Character;
import com.gridlockdm.domain.character.CharacterRepository;
import com.gridlockdm.domain.session.SessionInvite.InviteStatus;
import com.gridlockdm.domain.user.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class SessionService {

    private final SessionRepository          sessionRepo;
    private final SessionInviteRepository    inviteRepo;
    private final SessionCharacterRepository sessionCharRepo;
    private final CharacterRepository        characterRepo;
    private final InviteCodeGenerator        codeGenerator;
    private final JwtTokenProvider           jwtTokenProvider;
    private final SimpMessagingTemplate      messaging;
    private final MapUploadService           mapUploadService;

    // ── Session lifecycle ─────────────────────────────────────────────────────

    @Transactional
    public Session createSession(User dm, String name, InviteMode mode) {
        String code = codeGenerator.generate(sessionRepo::existsByInviteCode);

        Session session = Session.builder()
                .dm(dm)
                .name(name)
                .inviteCode(code)
                .inviteMode(mode)
                .status(SessionStatus.LOBBY)
                .build();

        sessionRepo.save(session);
        log.info("Session created: {} (code={}, dm={})", name, code, dm.getEmail());
        return session;
    }

    @Transactional
    public Session startSession(UUID sessionId, User dm) {
        Session session = requireSession(sessionId);
        requireDm(session, dm);

        session.setStatus(SessionStatus.ACTIVE);
        sessionRepo.save(session);

        broadcast(session.getInviteCode(), "SESSION_STARTED", session.getId());
        return session;
    }

    @Transactional
    public Session endSession(UUID sessionId, User dm) {
        Session session = requireSession(sessionId);
        requireDm(session, dm);

        session.setStatus(SessionStatus.ENDED);
        sessionRepo.save(session);

        broadcast(session.getInviteCode(), "SESSION_ENDED", session.getId());
        log.info("Session ended: {}", session.getInviteCode());
        return session;
    }

    // ── Join flow ─────────────────────────────────────────────────────────────

    /**
     * Player requests to join a session with a chosen character.
     *
     * - OPEN mode  → immediately accepted, SessionCharacter created, all clients notified
     * - DM_APPROVAL → invite record created as PENDING; DM sees it in their panel
     */
    @Transactional
    public JoinResult requestJoin(String inviteCode, User player, UUID characterId) {
        Session session = sessionRepo.findByInviteCode(inviteCode)
                .orElseThrow(() -> new ResourceNotFoundException("Session not found: " + inviteCode));

        if (session.getStatus() == SessionStatus.ENDED) {
            throw new IllegalStateException("Session has ended");
        }

        // Verify the character belongs to this player
        Character character = characterRepo.findByIdAndOwnerId(characterId, player.getId())
                .orElseThrow(() -> new ForbiddenException("Character not found or not owned by you"));

        // Prevent duplicate requests
        if (inviteRepo.existsBySessionIdAndUserIdAndStatus(
                session.getId(), player.getId(), InviteStatus.PENDING)) {
            throw new IllegalStateException("You already have a pending join request for this session");
        }

        if (session.getInviteMode() == InviteMode.OPEN) {
            SessionCharacter sc = acceptPlayer(session, player, character);
            return JoinResult.accepted(sc);
        } else {
            SessionInvite invite = SessionInvite.builder()
                    .session(session)
                    .user(player)
                    .character(character)
                    .status(InviteStatus.PENDING)
                    .build();
            inviteRepo.save(invite);

            // Notify DM panel via WebSocket
            broadcastToDm(session.getInviteCode(), "JOIN_REQUEST", InviteDto.from(invite));
            log.info("Join request pending: {} → session {}", player.getEmail(), inviteCode);
            return JoinResult.pending(invite);
        }
    }

    /** DM accepts a pending join request */
    @Transactional
    public SessionCharacter acceptInvite(UUID inviteId, User dm) {
        SessionInvite invite = inviteRepo.findById(inviteId)
                .orElseThrow(() -> new ResourceNotFoundException("Invite not found"));

        requireDm(invite.getSession(), dm);

        if (invite.getStatus() != InviteStatus.PENDING) {
            throw new IllegalStateException("Invite is no longer pending");
        }

        invite.setStatus(InviteStatus.ACCEPTED);
        invite.setResolvedAt(Instant.now());
        inviteRepo.save(invite);

        SessionCharacter sc = acceptPlayer(invite.getSession(), invite.getUser(), invite.getCharacter());

        // Notify the player their request was accepted
        messaging.convertAndSendToUser(
                invite.getUser().getId().toString(),
                "/queue/invite-result",
                new InviteResultDto("ACCEPTED", invite.getSession().getInviteCode()));

        return sc;
    }

    /** DM denies a pending join request */
    @Transactional
    public void denyInvite(UUID inviteId, User dm) {
        SessionInvite invite = inviteRepo.findById(inviteId)
                .orElseThrow(() -> new ResourceNotFoundException("Invite not found"));

        requireDm(invite.getSession(), dm);

        invite.setStatus(InviteStatus.DENIED);
        invite.setResolvedAt(Instant.now());
        inviteRepo.save(invite);

        // Notify the player
        messaging.convertAndSendToUser(
                invite.getUser().getId().toString(),
                "/queue/invite-result",
                new InviteResultDto("DENIED", invite.getSession().getInviteCode()));

        log.info("Invite denied: user={}", invite.getUser().getEmail());
    }

    // ── Observer token ────────────────────────────────────────────────────────

    /**
     * DM generates a read-only observer token for a TV/projector view.
     * The token is a signed JWT; no DB lookup needed to validate it.
     */
    public String generateObserverToken(UUID sessionId, User dm, String label) {
        Session session = requireSession(sessionId);
        requireDm(session, dm);
        return jwtTokenProvider.createObserverToken(sessionId, label);
    }

    // ── Map upload ────────────────────────────────────────────────────────────

    @Transactional
    public Session uploadMap(UUID sessionId, User dm, MultipartFile file) throws IOException {
        Session session = requireSession(sessionId);
        requireDm(session, dm);

        MapUploadService.UploadResult result = mapUploadService.store(file);
        session.setMapImageUrl(result.url());
        session.setGridConfig(result.gridConfig());
        session.setUpdatedAt(Instant.now());
        sessionRepo.save(session);

        broadcast(session.getInviteCode(), "MAP_LOADED",
                new MapLoadedDto(result.url(), result.gridConfig()));

        log.info("Map uploaded for session {}: {}", session.getInviteCode(), result.url());
        return session;
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public Session getSessionByCode(String inviteCode) {
        return sessionRepo.findByInviteCode(inviteCode)
                .orElseThrow(() -> new ResourceNotFoundException("Session not found: " + inviteCode));
    }

    @Transactional(readOnly = true)
    public List<Session> getDmSessions(UUID dmId) {
        return sessionRepo.findByDmIdOrderByCreatedAtDesc(dmId);
    }

    @Transactional(readOnly = true)
    public List<SessionInvite> getPendingInvites(UUID sessionId, User dm) {
        Session session = requireSession(sessionId);
        requireDm(session, dm);
        return inviteRepo.findBySessionIdAndStatus(sessionId, InviteStatus.PENDING);
    }

    @Transactional(readOnly = true)
    public List<SessionCharacter> getSessionRoster(UUID sessionId) {
        return sessionCharRepo.findBySessionIdAndActiveTrue(sessionId);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private SessionCharacter acceptPlayer(Session session, User player, Character character) {
        SessionCharacter sc = SessionCharacter.builder()
                .session(session)
                .character(character)
                .player(player)
                .currentHp(character.getCurrentHp() != null
                        ? character.getCurrentHp()
                        : character.getMaxHp())
                .tokenType(SessionCharacter.TokenType.PLAYER)
                .build();

        sessionCharRepo.save(sc);

        // Notify all clients that a new player joined
        broadcast(session.getInviteCode(), "PLAYER_JOINED", SessionCharacterDto.from(sc));
        log.info("Player {} joined session {}", player.getEmail(), session.getInviteCode());
        return sc;
    }

    private Session requireSession(UUID sessionId) {
        return sessionRepo.findById(sessionId)
                .orElseThrow(() -> new ResourceNotFoundException("Session not found: " + sessionId));
    }

    private void requireDm(Session session, User user) {
        if (!session.getDm().getId().equals(user.getId())) {
            throw new ForbiddenException("Only the DM can perform this action");
        }
    }

    private void broadcast(String sessionCode, String type, Object payload) {
        messaging.convertAndSend(
                "/topic/session/" + sessionCode,
                new SessionEvent(type, payload));
    }

    private void broadcastToDm(String sessionCode, String type, Object payload) {
        messaging.convertAndSend(
                "/topic/session/" + sessionCode + "/dm",
                new SessionEvent(type, payload));
    }

    // ── Return types ──────────────────────────────────────────────────────────

    public sealed interface JoinResult permits JoinResult.Accepted, JoinResult.Pending {
        record Accepted(SessionCharacter sessionCharacter) implements JoinResult {}
        record Pending(SessionInvite invite)               implements JoinResult {}

        static JoinResult accepted(SessionCharacter sc)   { return new Accepted(sc); }
        static JoinResult pending(SessionInvite invite)   { return new Pending(invite); }
    }

    public record SessionEvent(String type, Object payload) {}
    public record InviteResultDto(String status, String sessionCode) {}
    public record MapLoadedDto(String mapImageUrl, Map<String, Object> gridConfig) {}

    public record InviteDto(
            UUID   id,
            String playerName,
            String playerEmail,
            String characterName,
            String characterClass,
            int    characterLevel,
            String requestedAt
    ) {
        public static InviteDto from(SessionInvite i) {
            return new InviteDto(
                    i.getId(),
                    i.getUser().getDisplayName(),
                    i.getUser().getEmail(),
                    i.getCharacter().getName(),
                    i.getCharacter().getClassName(),
                    i.getCharacter().getLevel(),
                    i.getRequestedAt().toString());
        }
    }

    public record SessionCharacterDto(
            UUID   id,
            UUID   characterId,
            String characterName,
            String playerName,
            String tokenType,
            int    speed,
            Integer currentHp,
            Integer maxHp,
            Double  positionX,
            Double  positionY,
            List<String> conditions
    ) {
        public static SessionCharacterDto from(SessionCharacter sc) {
            Character c = sc.getCharacter();
            return new SessionCharacterDto(
                    sc.getId(),
                    c.getId(),
                    c.getName(),
                    sc.getPlayer().getDisplayName(),
                    sc.getTokenType().name(),
                    c.effectiveSpeed(),
                    sc.getCurrentHp(),
                    c.getMaxHp(),
                    sc.getPositionX(),
                    sc.getPositionY(),
                    sc.getConditions());
        }
    }
}
