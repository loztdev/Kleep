import { InMemoryVectorStore } from "../inMemoryVectorStore";
import { describeVectorStoreContract } from "./vectorStore.contract";

describeVectorStoreContract("InMemoryVectorStore", () => new InMemoryVectorStore());
