import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { connectDb, disconnectDb } from "../db.js";
import { User, type AccountType } from "../models/User.js";

interface SeedRow {
  email: string;
  username: string;
  passwordHash: string;
  accountType: AccountType;
  isActive?: string;
}

const csvPath =
  process.env.SEED_CSV_PATH ?? "../../data/csv/user-seed-data.csv";

function toUser(row: SeedRow, line: number) {
  if (!/^e\d{7}@u\.nus\.edu$/.test(row.email)) {
    throw new Error(`Line ${line}: invalid NUS email "${row.email}"`);
  }

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(row.username)) {
    throw new Error(`Line ${line}: invalid username "${row.username}"`);
  }

  if (!/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(row.passwordHash)) {
    throw new Error(`Line ${line} (${row.email}): invalid bcrypt password hash`);
  }

  if (!(["USER", "ADMIN", "SUPERADMIN"] as AccountType[]).includes(row.accountType)) {
    throw new Error(`Line ${line} (${row.email}): invalid account type`);
  }

  if (row.isActive !== undefined && row.isActive !== "true" && row.isActive !== "false") {
    throw new Error(`Line ${line} (${row.email}): isActive must be true or false`);
  }

  return {
    email: row.email.toLowerCase(),
    username: row.username,
    passwordHash: row.passwordHash,
    accountType: row.accountType,
    isActive: row.isActive !== "false",
  };
}

async function main(): Promise<void> {
  const rows: SeedRow[] = parse(await readFile(csvPath), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  const users = [];
  for (const [i, row] of rows.entries()) {
    const line = i + 2;
    const user = toUser(row, line);

    try {
      await new User(user).validate();
    } catch (error) {
      throw new Error(`Line ${line} (${row.email}): ${(error as Error).message}`);
    }

    users.push(user);
  }

  await connectDb();

  // Backfill accounts created before the isActive field was introduced.
  await User.updateMany(
    { isActive: { $exists: false } },
    { $set: { isActive: true } },
  );

  const result = await User.bulkWrite(
    users.map((user) => ({
      updateOne: {
        filter: { email: user.email },
        update: { $setOnInsert: user },
        upsert: true,
      },
    })),
  );

  console.log(
    `Users seeded: ${result.upsertedCount} inserted, ${result.matchedCount} already present`,
  );
}

main()
  .then(disconnectDb)
  .catch(async (error) => {
    console.error("User seeding failed:", error);
    await disconnectDb();
    process.exitCode = 1;
  });
