import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Child } from "../domain/child";
import { findPossibleDuplicates, toChild } from "../infra/repos/children";
import { isValidDateString } from "../engine/duration";
import { todayLocal } from "../infra/time";

export interface RegisterChildInput {
  familyName: string;
  givenName: string;
  birthDate: string;
  fatherName?: string;
  motherName?: string;
  address?: string;
  centreId?: string;
  firstVisitYear?: string;
  /** Set when the nurse confirms registration despite a duplicate warning. */
  force?: boolean;
}

export type RegisterChildResult =
  | { status: "created"; child: Child }
  | { status: "duplicate"; duplicates: Child[] };

/**
 * Deep Child registration seam: duplicate warning + insert + `xx/YYYY`
 * allocation commit in one transaction, or nothing. Callers get a
 * discriminated result instead of composing repos + counter transactions.
 */
export function registerChild(db: Database.Database, input: RegisterChildInput): RegisterChildResult {
  if (!isValidDateString(input.birthDate)) {
    throw new Error(`birthDate ${input.birthDate} must be a real YYYY-MM-DD calendar date`);
  }
  if (input.birthDate > todayLocal()) {
    throw new Error(`birthDate ${input.birthDate} is in the future`);
  }
  if (!input.force) {
    const duplicates = findPossibleDuplicates(db, input.familyName, input.givenName, input.birthDate);
    if (duplicates.length > 0) return { status: "duplicate", duplicates };
  }
  if ((input.centreId && !input.firstVisitYear) || (!input.centreId && input.firstVisitYear)) {
    throw new Error("centreId and firstVisitYear are required together");
  }
  if (input.firstVisitYear && !/^\d{4}$/.test(input.firstVisitYear)) {
    throw new Error(`firstVisitYear ${input.firstVisitYear} must be YYYY`);
  }

  const child = db.transaction((): Child => {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO children (id, family_name, given_name, birth_date, father_name, mother_name, address) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      input.familyName,
      input.givenName,
      input.birthDate,
      input.fatherName ?? null,
      input.motherName ?? null,
      input.address ?? null
    );

    let localIds: { centreId: string; value: string }[] = [];
    if (input.centreId && input.firstVisitYear) {
      const cur = db
        .prepare("SELECT last_xx FROM id_counters WHERE centre_id = ? AND year = ?")
        .get(input.centreId, input.firstVisitYear) as { last_xx: number } | undefined;
      const xx = (cur?.last_xx ?? 0) + 1;
      db.prepare(
        "INSERT INTO id_counters (centre_id, year, last_xx) VALUES (?, ?, ?) ON CONFLICT (centre_id, year) DO UPDATE SET last_xx = ?"
      ).run(input.centreId, input.firstVisitYear, xx, xx);
      const value = `${xx}/${input.firstVisitYear}`;
      db.prepare("INSERT INTO local_ids (child_id, centre_id, value) VALUES (?, ?, ?)").run(id, input.centreId, value);
      localIds = [{ centreId: input.centreId, value }];
    }

    const row = db.prepare("SELECT * FROM children WHERE id = ?").get(id) as {
      id: string; family_name: string; given_name: string; birth_date: string;
      father_name: string | null; mother_name: string | null; address: string | null; national_id: string | null;
    };
    return toChild(row, localIds);
  })();
  return { status: "created", child };
}
