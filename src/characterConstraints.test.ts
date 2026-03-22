import { describe, it, expect } from "vitest";
import {
    getValidRaces,
    getValidAlignments,
    getValidGenders,
    getValidRoles,
    validateCharacterOptions,
    ROLE_CONSTRAINTS,
    RACE_CONSTRAINTS,
} from "@neth4ck/api";

describe("characterConstraints", () => {
    describe("getValidRaces", () => {
        it("returns all races when no role specified", () => {
            expect(getValidRaces()).toEqual(["hum", "elf", "dwa", "gno", "orc"]);
        });

        it("returns only Human and Gnome for Healer", () => {
            expect(getValidRaces("hea")).toEqual(["hum", "gno"]);
        });

        it("returns only Human for Knight", () => {
            expect(getValidRaces("kni")).toEqual(["hum"]);
        });

        it("returns Human, Elf, Gnome, Orc for Wizard", () => {
            expect(getValidRaces("wiz")).toEqual(["hum", "elf", "gno", "orc"]);
        });
    });

    describe("getValidAlignments", () => {
        it("returns all alignments when nothing specified", () => {
            expect(getValidAlignments()).toEqual(["law", "neu", "cha"]);
        });

        it("returns only Neutral for Healer", () => {
            expect(getValidAlignments("hea")).toEqual(["neu"]);
        });

        it("narrows by race — Elf can only be Chaotic", () => {
            expect(getValidAlignments(undefined, "elf")).toEqual(["cha"]);
        });

        it("intersects role and race — Ranger + Orc = Chaotic only", () => {
            // Ranger allows neu, cha; Orc allows cha only → cha
            expect(getValidAlignments("ran", "orc")).toEqual(["cha"]);
        });

        it("intersects role and race — Priest + Elf = Chaotic only", () => {
            // Priest allows law, neu, cha; Elf allows cha only → cha
            expect(getValidAlignments("pri", "elf")).toEqual(["cha"]);
        });
    });

    describe("getValidGenders", () => {
        it("returns both genders for most roles", () => {
            expect(getValidGenders("hea")).toEqual(["mal", "fem"]);
        });

        it("returns only Female for Valkyrie", () => {
            expect(getValidGenders("val")).toEqual(["fem"]);
        });

        it("returns both genders when no role specified", () => {
            expect(getValidGenders()).toEqual(["mal", "fem"]);
        });
    });

    describe("getValidRoles", () => {
        it("returns all roles with no filters", () => {
            expect(getValidRoles()).toHaveLength(13);
        });

        it("filters by race — Elf limits to Priest, Ranger, Wizard", () => {
            expect(getValidRoles({ race: "elf" })).toEqual(["pri", "ran", "wiz"]);
        });

        it("filters by gender — Male excludes Valkyrie", () => {
            const roles = getValidRoles({ gender: "mal" });
            expect(roles).not.toContain("val");
            expect(roles).toHaveLength(12);
        });

        it("filters by alignment — Lawful excludes Barbarian, Rogue, etc.", () => {
            const roles = getValidRoles({ align: "law" });
            expect(roles).toContain("kni");
            expect(roles).toContain("sam");
            expect(roles).not.toContain("rog");
            expect(roles).not.toContain("bar");
        });
    });

    describe("validateCharacterOptions", () => {
        it("accepts valid combination: Human Healer Neutral Male", () => {
            const result = validateCharacterOptions({ role: "hea", race: "hum", align: "neu", gender: "mal" });
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("accepts partial options", () => {
            expect(validateCharacterOptions({ role: "wiz" }).valid).toBe(true);
            expect(validateCharacterOptions({}).valid).toBe(true);
        });

        it("rejects Elf Healer", () => {
            const result = validateCharacterOptions({ role: "hea", race: "elf" });
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain("Healer");
            expect(result.errors[0]).toContain("Elf");
        });

        it("rejects Chaotic Healer", () => {
            const result = validateCharacterOptions({ role: "hea", align: "cha" });
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain("Healer");
            expect(result.errors[0]).toContain("Chaotic");
        });

        it("rejects Chaotic Elf Healer with multiple errors", () => {
            const result = validateCharacterOptions({ role: "hea", race: "elf", align: "cha" });
            expect(result.valid).toBe(false);
            // Should have errors for: race invalid for role, align invalid for role
            expect(result.errors.length).toBeGreaterThanOrEqual(2);
        });

        it("rejects Male Valkyrie", () => {
            const result = validateCharacterOptions({ role: "val", gender: "mal" });
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain("Valkyrie");
            expect(result.errors[0]).toContain("Male");
        });

        it("rejects Lawful Orc (race-alignment conflict)", () => {
            const result = validateCharacterOptions({ race: "orc", align: "law" });
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain("Orc");
            expect(result.errors[0]).toContain("Lawful");
        });

        it("rejects unknown role", () => {
            const result = validateCharacterOptions({ role: "xxx" });
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain("Unknown role");
        });
    });
});
