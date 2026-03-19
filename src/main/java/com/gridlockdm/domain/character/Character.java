package com.gridlockdm.domain.character;

import com.gridlockdm.domain.user.User;
import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "characters")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Character {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "owner_id", nullable = false)
    private User owner;

    // ── Identity ──────────────────────────────────────────────────────────────

    @Column(nullable = false)
    private String name;

    private String race;

    @Column(name = "class_name")
    private String className;

    private String subclass;

    @Column(nullable = false)
    @Builder.Default
    private Integer level = 1;

    private String background;

    // ── Combat stats ──────────────────────────────────────────────────────────

    @Column(name = "max_hp")
    private Integer maxHp;

    @Column(name = "current_hp")
    private Integer currentHp;

    @Column(name = "temp_hp")
    @Builder.Default
    private Integer tempHp = 0;

    @Column(name = "armor_class")
    private Integer armorClass;

    /** Movement speed in feet — D&D 5e default is 30 */
    @Column(nullable = false)
    @Builder.Default
    private Integer speed = 30;

    @Column(name = "fly_speed")
    private Integer flySpeed;

    @Column(name = "swim_speed")
    private Integer swimSpeed;

    @Column(name = "initiative_bonus")
    @Builder.Default
    private Integer initiativeBonus = 0;

    @Column(name = "proficiency_bonus")
    @Builder.Default
    private Integer proficiencyBonus = 2;

    // ── Ability scores ────────────────────────────────────────────────────────

    @Column(name = "str")
    private Integer strength;

    @Column(name = "dex")
    private Integer dexterity;

    @Column(name = "con")
    private Integer constitution;

    @Column(name = "int_score")
    private Integer intelligence;

    @Column(name = "wis")
    private Integer wisdom;

    @Column(name = "cha")
    private Integer charisma;

    // ── Flexible JSON fields ──────────────────────────────────────────────────

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> spells;

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> features;

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> equipment;

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> proficiencies;

    @Column(columnDefinition = "TEXT")
    private String notes;

    // ── Import metadata ───────────────────────────────────────────────────────

    @Enumerated(EnumType.STRING)
    @Column(name = "import_source", nullable = false)
    @Builder.Default
    private ImportSource importSource = ImportSource.MANUAL;

    @Column(name = "ddb_character_id")
    private String ddbCharacterId;

    /** Full raw payload from DDB API or extracted PDF fields */
    @Type(JsonType.class)
    @Column(name = "raw_source", columnDefinition = "jsonb")
    private Map<String, Object> rawSource;

    @Column(name = "avatar_url")
    private String avatarUrl;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Returns the effective movement speed in feet for token display. */
    public int effectiveSpeed() {
        return speed != null ? speed : 30;
    }

    public enum ImportSource {
        DDB_API, PDF, MANUAL
    }
}
