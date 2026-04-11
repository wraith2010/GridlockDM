package com.gridlockdm.domain.session;

import com.gridlockdm.domain.session.SessionService.*;
import com.gridlockdm.domain.user.User;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/sessions")
@RequiredArgsConstructor
public class SessionController {

    private final SessionService sessionService;

    // ── DM: create session ────────────────────────────────────────────────────

    /**
     * POST /api/sessions
     * Body: { name, inviteMode }
     */
    @PostMapping
    public ResponseEntity<SessionSummaryDto> create(
            @Valid @RequestBody CreateSessionRequest req,
            @AuthenticationPrincipal User dm) {

        Session session = sessionService.createSession(dm, req.name(), req.inviteMode());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(SessionSummaryDto.from(session));
    }

    // ── Public: session info by invite code ───────────────────────────────────

    /**
     * GET /api/sessions/{code}/info
     * Public — returns enough info to display the join screen before login.
     */
    @GetMapping("/{code}/info")
    public ResponseEntity<SessionInfoDto> info(@PathVariable String code) {
        Session session = sessionService.getSessionByCode(code);
        return ResponseEntity.ok(SessionInfoDto.from(session));
    }

    // ── Player: request to join ───────────────────────────────────────────────

    /**
     * POST /api/sessions/{code}/join
     * Body: { characterId }
     */
    @PostMapping("/{code}/join")
    public ResponseEntity<JoinResponseDto> join(
            @PathVariable String code,
            @Valid @RequestBody JoinRequest req,
            @AuthenticationPrincipal User player) {

        JoinResult result = sessionService.requestJoin(code, player, req.characterId());

        return switch (result) {
            case JoinResult.Accepted a -> ResponseEntity.ok(
                    new JoinResponseDto("ACCEPTED", null, SessionCharacterDto.from(a.sessionCharacter())));
            case JoinResult.Pending p  -> ResponseEntity.accepted()
                    .body(new JoinResponseDto("PENDING", p.invite().getId(), null));
        };
    }

    // ── DM: manage pending invites ────────────────────────────────────────────

    /**
     * GET /api/sessions/{id}/invites/pending
     */
    @GetMapping("/{id}/invites/pending")
    public ResponseEntity<List<InviteDto>> pendingInvites(
            @PathVariable UUID id,
            @AuthenticationPrincipal User dm) {

        return ResponseEntity.ok(
                sessionService.getPendingInvites(id, dm)
                              .stream()
                              .map(InviteDto::from)
                              .toList());
    }

    /**
     * POST /api/sessions/invites/{inviteId}/accept
     */
    @PostMapping("/invites/{inviteId}/accept")
    public ResponseEntity<SessionCharacterDto> accept(
            @PathVariable UUID inviteId,
            @AuthenticationPrincipal User dm) {

        SessionCharacter sc = sessionService.acceptInvite(inviteId, dm);
        return ResponseEntity.ok(SessionCharacterDto.from(sc));
    }

    /**
     * POST /api/sessions/invites/{inviteId}/deny
     */
    @PostMapping("/invites/{inviteId}/deny")
    public ResponseEntity<Void> deny(
            @PathVariable UUID inviteId,
            @AuthenticationPrincipal User dm) {

        sessionService.denyInvite(inviteId, dm);
        return ResponseEntity.noContent().build();
    }

    // ── DM: fog of war ───────────────────────────────────────────────────────

    @PostMapping("/{id}/fog/reveal-all")
    public ResponseEntity<Void> revealAllFog(
            @PathVariable UUID id,
            @AuthenticationPrincipal User dm) {

        sessionService.revealAllFog(id, dm, true);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/fog/hide-all")
    public ResponseEntity<Void> hideAllFog(
            @PathVariable UUID id,
            @AuthenticationPrincipal User dm) {

        sessionService.revealAllFog(id, dm, false);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{id}/fog")
    public ResponseEntity<Void> updateFog(
            @PathVariable UUID id,
            @RequestBody Map<String, Boolean> cells,
            @AuthenticationPrincipal User dm) {

        sessionService.updateFogCells(id, dm, cells);
        return ResponseEntity.noContent().build();
    }

    // ── DM: update grid config ────────────────────────────────────────────────

    @PatchMapping("/{id}/grid")
    public ResponseEntity<Void> updateGrid(
            @PathVariable UUID id,
            @RequestBody Map<String, Object> gridConfig,
            @AuthenticationPrincipal User dm) {

        sessionService.updateGridConfig(id, dm, gridConfig);
        return ResponseEntity.noContent().build();
    }

    // ── DM: update zone cells ─────────────────────────────────────────────────

    @DeleteMapping("/{id}/zones")
    public ResponseEntity<Void> clearZones(
            @PathVariable UUID id,
            @AuthenticationPrincipal User dm) {

        sessionService.clearZones(id, dm);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{id}/zones")
    public ResponseEntity<Void> updateZones(
            @PathVariable UUID id,
            @RequestBody Map<String, String> zones,
            @AuthenticationPrincipal User dm) {

        sessionService.updateZones(id, dm, zones);
        return ResponseEntity.noContent().build();
    }

    // ── DM: spell overlays ───────────────────────────────────────────────────

    @PostMapping("/{id}/spell-overlays")
    public ResponseEntity<Void> addSpellOverlay(
            @PathVariable UUID id,
            @RequestBody Map<String, Object> overlay,
            @AuthenticationPrincipal User user) {

        sessionService.addSpellOverlay(id, user, overlay);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{id}/spell-overlays/{overlayId}")
    public ResponseEntity<Void> removeSpellOverlay(
            @PathVariable UUID id,
            @PathVariable String overlayId,
            @AuthenticationPrincipal User user) {

        sessionService.removeSpellOverlay(id, user, overlayId);
        return ResponseEntity.noContent().build();
    }

    // ── DM: upload battlemap ──────────────────────────────────────────────────

    /**
     * POST /api/sessions/{id}/map
     * Multipart: file = image (JPEG / PNG / WebP / GIF)
     * DM only. Saves the image, derives a default grid config, broadcasts MAP_LOADED.
     */
    @PostMapping(value = "/{id}/map", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<SessionInfoDto> uploadMap(
            @PathVariable UUID id,
            @RequestParam("file") MultipartFile file,
            @AuthenticationPrincipal User dm) throws IOException {

        Session session = sessionService.uploadMap(id, dm, file);
        return ResponseEntity.ok(SessionInfoDto.from(session));
    }

    // ── DM: session lifecycle ─────────────────────────────────────────────────

    @PostMapping("/{id}/start")
    public ResponseEntity<SessionSummaryDto> start(
            @PathVariable UUID id,
            @AuthenticationPrincipal User dm) {

        return ResponseEntity.ok(SessionSummaryDto.from(sessionService.startSession(id, dm)));
    }

    @PostMapping("/{id}/end")
    public ResponseEntity<SessionSummaryDto> end(
            @PathVariable UUID id,
            @AuthenticationPrincipal User dm) {

        return ResponseEntity.ok(SessionSummaryDto.from(sessionService.endSession(id, dm)));
    }

    // ── DM: observer token ────────────────────────────────────────────────────

    /**
     * POST /api/sessions/{id}/observer-link
     * Body: { label }   e.g. "Table TV"
     */
    @PostMapping("/{id}/observer-link")
    public ResponseEntity<Map<String, String>> observerLink(
            @PathVariable UUID id,
            @RequestBody Map<String, String> body,
            @AuthenticationPrincipal User dm) {

        String label = body.getOrDefault("label", "Observer");
        String token = sessionService.generateObserverToken(id, dm, label);
        return ResponseEntity.ok(Map.of("observerToken", token));
    }

    // ── DM: session roster ────────────────────────────────────────────────────

    @GetMapping("/{id}/roster")
    public ResponseEntity<List<SessionCharacterDto>> roster(@PathVariable UUID id) {
        return ResponseEntity.ok(
                sessionService.getSessionRoster(id)
                              .stream()
                              .map(SessionCharacterDto::from)
                              .toList());
    }

    // ── DM: my sessions ──────────────────────────────────────────────────────

    @GetMapping("/my")
    public ResponseEntity<List<SessionSummaryDto>> mySessions(@AuthenticationPrincipal User dm) {
        return ResponseEntity.ok(
                sessionService.getDmSessions(dm.getId())
                              .stream()
                              .map(SessionSummaryDto::from)
                              .toList());
    }

    // ── Request / Response DTOs ───────────────────────────────────────────────

    public record CreateSessionRequest(
            @NotBlank String name,
            @NotNull  InviteMode inviteMode
    ) {}

    public record JoinRequest(@NotNull UUID characterId) {}

    public record JoinResponseDto(
            String status,               // ACCEPTED | PENDING
            UUID   inviteId,             // populated when PENDING
            SessionCharacterDto character // populated when ACCEPTED
    ) {}

    public record SessionSummaryDto(
            UUID   id,
            String name,
            String inviteCode,
            String inviteMode,
            String status,
            String dmName,
            String createdAt
    ) {
        static SessionSummaryDto from(Session s) {
            return new SessionSummaryDto(
                    s.getId(), s.getName(), s.getInviteCode(),
                    s.getInviteMode().name(), s.getStatus().name(),
                    s.getDm().getDisplayName(), s.getCreatedAt().toString());
        }
    }

    public record SessionInfoDto(
            UUID   id,
            String name,
            String inviteCode,
            String inviteMode,
            String status,
            String dmName,
            String mapImageUrl,
            Object gridConfig,
            Object zones,
            Object fogState,
            Object activeOverlays
    ) {
        static SessionInfoDto from(Session s) {
            return new SessionInfoDto(
                    s.getId(), s.getName(), s.getInviteCode(),
                    s.getInviteMode().name(), s.getStatus().name(),
                    s.getDm().getDisplayName(),
                    s.getMapImageUrl(), s.getGridConfig(), s.getZones(), s.getFogState(),
                    s.getActiveOverlays() != null ? s.getActiveOverlays() : java.util.List.of());
        }
    }
}
