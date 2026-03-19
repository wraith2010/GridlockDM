package com.gridlockdm.domain.session;

import com.gridlockdm.domain.character.Character;
import com.gridlockdm.domain.user.User;
import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Represents a character that has been accepted into a session.
 * Stores session-specific state (current HP, position, conditions)
 * separately from the base character sheet.
 */
@Entity
@Table(name = "session_characters")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SessionCharacter {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false)
    private Session session;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "character_id", nullable = false)
    private Character character;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "player_id", nullable = false)
    private User player;

    // ── Session-specific overrides ────────────────────────────────────────────

    @Column(name = "current_hp")
    private Integer currentHp;

    @Column(name = "temp_hp")
    @Builder.Default
    private Integer tempHp = 0;

    /** Grid-cell X coordinate — null means not yet placed on the map */
    @Column(name = "position_x")
    private Double positionX;

    /** Grid-cell Y coordinate */
    @Column(name = "position_y")
    private Double positionY;

    /**
     * Active D&D conditions — stored as a JSON array of strings.
     * e.g. ["Slowed", "Prone", "Concentrating"]
     */
    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<String> conditions = new ArrayList<>();

    @Column(name = "is_active", nullable = false)
    @Builder.Default
    private boolean active = true;

    @Enumerated(EnumType.STRING)
    @Column(name = "token_type", nullable = false)
    @Builder.Default
    private TokenType tokenType = TokenType.PLAYER;

    @Column(name = "joined_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant joinedAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    // ── Helpers ───────────────────────────────────────────────────────────────

    public void addCondition(String condition) {
        if (!conditions.contains(condition)) {
            conditions.add(condition);
        }
    }

    public void removeCondition(String condition) {
        conditions.remove(condition);
    }

    public boolean hasCondition(String condition) {
        return conditions.contains(condition);
    }

    public boolean isPlaced() {
        return positionX != null && positionY != null;
    }

    public enum TokenType {
        PLAYER, NPC, SUMMON
    }
}
