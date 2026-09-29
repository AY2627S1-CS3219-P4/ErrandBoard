import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { connectDb, disconnectDb } from "../config/db.js";
import { Supplier, type SupplierCategory } from "../models/Supplier.js";

// Maps the CSV "Type" column to the model's categories
const CATEGORY_BY_TYPE: Record<string, SupplierCategory> = {
    "Food": "FOOD_BEVERAGE",
    "Food/Coffee": "FOOD_BEVERAGE",
    "Shopping": "RETAIL",
    "Printing": "PRINTING",
};

interface SeedRow {
    Name: string;
    Type: string;
    Building: string;
    Address: string;
    "Location Description": string;
    Latitude: string;
    Longitude: string;
    openingHours: string;
    ImageURL: string;
}

const csvPath = process.env.SEED_CSV_PATH ?? "../../data/csv/supplier-seed-data.csv";

function toSupplier(row: SeedRow, line: number) {
    const category = CATEGORY_BY_TYPE[row.Type];
    if (!category) {
        console.warn(`Line ${line}: unknown type "${row.Type}", using OTHER`);
    }

    let openingHours;
    try {
        openingHours = JSON.parse(row.openingHours);
    } catch {
        throw new Error(`Line ${line} (${row.Name}): openingHours is not valid JSON`);
    }

    return {
        name: row.Name,
        category: category ?? "OTHER",
        building: row.Building,
        address: row.Address,
        locationDescription: row["Location Description"] || undefined,
        coordinates: {
            latitude: Number(row.Latitude),
            longitude: Number(row.Longitude),
        },
        openingHours,
        imageUrl: row.ImageURL || undefined,
        isActive: true,
    };
}

async function main(): Promise<void> {
    const rows: SeedRow[] = parse(await readFile(csvPath), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
    });

    // Validate all suppliers according to schema rules before pushing to db
    const suppliers = [];
    for (const [i, row] of rows.entries()) {
        const line = i + 2;
        const supplier = toSupplier(row, line);
        try {
            await new Supplier(supplier).validate();
        } catch (error) {
            throw new Error(`Line ${line} (${row.Name}): ${(error as Error).message}`);
        }
        suppliers.push(supplier);
    }

    await connectDb();

    const result = await Supplier.bulkWrite(
        suppliers.map((supplier) => ({
            updateOne: {
                filter: { name: supplier.name, building: supplier.building },
                update: { $setOnInsert: supplier }, // ensures existing records are not touched
                upsert: true, // create a new document if no matches found
            },
        })),
    );

    console.log(
        `Suppliers seeded: ${result.upsertedCount} inserted, ${result.matchedCount} already present`,
    );
}

main()
    .then(disconnectDb)
    .catch(async (error) => {
        console.error("Supplier seeding failed:", error);
        await disconnectDb();
        process.exitCode = 1;
    });
