import { SqlitePromptStore } from "../sqlitePromptStore";
import { openTestDatabase } from "./betterSqliteAdapter";
import { describePromptStoreContract } from "./promptStore.contract";

describePromptStoreContract("SqlitePromptStore", () => new SqlitePromptStore(openTestDatabase()));
