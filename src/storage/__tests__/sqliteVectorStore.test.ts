import { SqliteVectorStore } from "../sqliteVectorStore";
import { openTestDatabase } from "./betterSqliteAdapter";
import { describeVectorStoreContract } from "./vectorStore.contract";

describeVectorStoreContract(
  "SqliteVectorStore",
  () => new SqliteVectorStore(openTestDatabase()),
);
