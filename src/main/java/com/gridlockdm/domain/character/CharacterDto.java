package com.gridlockdm.domain.character;

import com.gridlockdm.domain.user.User;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Request body for manual character creation and updates.
 * Validates core required fields; all combat stats are optional
 * so partial updates work cleanly.
 */
public record CharacterDto(

        @NotBlank(message = "Character name is required")
        String name,

        String  race,
        String  className,
        String  subclass,

        @Min(value = 1, message = "Level must be at least 1")
        Integer level,

        String  background,
        Integer maxHp,
        Integer currentHp,
        Integer tempHp,
        Integer armorClass,

        @Min(value = 0, message = "Speed cannot be negative")
        Integer speed,

        Integer flySpeed,
        Integer swimSpeed,
        Integer initiativeBonus,
        Integer proficiencyBonus,
        Integer strength,
        Integer dexterity,
        Integer constitution,
        Integer intelligence,
        Integer wisdom,
        Integer charisma,
        String  avatarUrl,
        String  notes
) {

    /** Create a new Character from this DTO */
    public Character toEntity(User owner) {
        Character c = Character.builder()
                .owner(owner)
                .name(name)
                .importSource(Character.ImportSource.MANUAL)
                .build();
        applyTo(c);
        return c;
    }

    /** Apply non-null DTO fields onto an existing character (for updates) */
    public void applyTo(Character c) {
        if (name         != null) c.setName(name);
        if (race         != null) c.setRace(race);
        if (className    != null) c.setClassName(className);
        if (subclass     != null) c.setSubclass(subclass);
        if (level        != null) c.setLevel(level);
        if (background   != null) c.setBackground(background);
        if (maxHp        != null) c.setMaxHp(maxHp);
        if (currentHp    != null) c.setCurrentHp(currentHp);
        if (tempHp       != null) c.setTempHp(tempHp);
        if (armorClass   != null) c.setArmorClass(armorClass);
        if (speed        != null) c.setSpeed(speed);
        if (flySpeed     != null) c.setFlySpeed(flySpeed);
        if (swimSpeed    != null) c.setSwimSpeed(swimSpeed);
        if (initiativeBonus  != null) c.setInitiativeBonus(initiativeBonus);
        if (proficiencyBonus != null) c.setProficiencyBonus(proficiencyBonus);
        if (strength     != null) c.setStrength(strength);
        if (dexterity    != null) c.setDexterity(dexterity);
        if (constitution != null) c.setConstitution(constitution);
        if (intelligence != null) c.setIntelligence(intelligence);
        if (wisdom       != null) c.setWisdom(wisdom);
        if (charisma     != null) c.setCharisma(charisma);
        if (avatarUrl    != null) c.setAvatarUrl(avatarUrl);
        if (notes        != null) c.setNotes(notes);
    }
}
