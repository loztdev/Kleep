import { InMemorySkillStore } from "../inMemorySkillStore";
import { describeSkillStoreContract } from "./skillStore.contract";

describeSkillStoreContract("InMemorySkillStore", () => new InMemorySkillStore());
