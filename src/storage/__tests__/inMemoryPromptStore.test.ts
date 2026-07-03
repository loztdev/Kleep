import { InMemoryPromptStore } from "../inMemoryPromptStore";
import { describePromptStoreContract } from "./promptStore.contract";

describePromptStoreContract("InMemoryPromptStore", () => new InMemoryPromptStore());
