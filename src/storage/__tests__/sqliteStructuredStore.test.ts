import { SqliteStructuredStore } from "../sqliteStructuredStore";
import { openTestDatabase } from "./betterSqliteAdapter";
import { describeStructuredStoreContract } from "./structuredStore.contract";

describeStructuredStoreContract(
  "SqliteStructuredStore",
  () => new SqliteStructuredStore(openTestDatabase()),
);
