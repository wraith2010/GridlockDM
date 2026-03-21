package com.gridlockdm.domain.session;

import com.gridlockdm.domain.user.User;
import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "sessions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Session {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "dm_id", nullable = false)
    private User dm;

    @Column(nullable = false)
    private String name;

    @Column(name = "invite_code", nullable = false, unique = true)
    private String inviteCode;

    @Enumerated(EnumType.STRING)
    @Column(name = "invite_mode", nullable = false)
    @Builder.Default
    private InviteMode inviteMode = InviteMode.DM_APPROVAL;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private SessionStatus status = SessionStatus.LOBBY;

    @Column(name = "map_image_url")
    private String mapImageUrl;

    /** { originX, originY, cellSizePx, cols, rows, confidence } */
    @Type(JsonType.class)
    @Column(name = "grid_config", columnDefinition = "jsonb")
    private Map<String, Object> gridConfig;

    /** Per-cell fog state — key "x,y" → true (revealed) / false (hidden) */
    @Type(JsonType.class)
    @Column(name = "fog_state", columnDefinition = "jsonb")
    private Map<String, Boolean> fogState;

    /** Per-cell zone types — key "x,y" → zone type name (e.g. "fire", "difficult") */
    @Type(JsonType.class)
    @Column(name = "zones", columnDefinition = "jsonb")
    private Map<String, String> zones;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();
}
