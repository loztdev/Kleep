import { SqliteSkillStore } from "../sqliteSkillStore";
import { openTestDatabase } from "./betterSqliteAdapter";
import { describeSkillStoreContract } from "./skillStore.contract";

describeSkillStoreContract("SqliteSkillStore", () => new SqliteSkillStore(openTestDatabase()));
