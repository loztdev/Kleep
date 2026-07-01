import { InMemoryStructuredStore } from "../inMemoryStructuredStore";
import { describeStructuredStoreContract } from "./structuredStore.contract";

describeStructuredStoreContract(
  "InMemoryStructuredStore",
  () => new InMemoryStructuredStore(),
);
