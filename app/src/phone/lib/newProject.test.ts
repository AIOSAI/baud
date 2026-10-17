import { afterEach, describe, expect, it, vi } from "vitest";

import { verbNewProject } from "../../host";
import { call } from "../../host/transport.http";
import type { NewProjectResult } from "../../types";
import { roomDoors } from "./rooms";
import {
  DEFAULT_TEMPLATE,
  NAME_HINT,
  TEMPLATES,
  bornCard,
  bornSeat,
  nameRefusal,
  validName,
} from "./newProject";

vi.mock("../../host/transport", () => import("../../host/transport.http"));

describe("the name rule", () => {
  it("takes a letter followed by letters, digits, _ and -", () => {
    for (const name of ["a", "phone-probe", "Vera_Studio", "x1", "a-b_c-9"]) {
      expect(validName(name)).toBe(true);
    }
  });

  it("refuses a name that does not start with a letter", () => {
    for (const name of ["1abc", "-abc", "_abc", "9"]) expect(validName(name)).toBe(false);
  });

  it("refuses anything outside the class, anywhere in the name", () => {
    for (const name of ["", "a b", "a.b", "a/b", "ab!", "a\nb", "abc ", " abc", "é"]) {
      expect(validName(name)).toBe(false);
    }
  });

  it("caps the name at 64 characters", () => {
    expect(validName(`a${"b".repeat(63)}`)).toBe(true);
    expect(validName(`a${"b".repeat(64)}`)).toBe(false);
  });

  it("refuses with a sentence carrying the hint, and says nothing for a good name", () => {
    expect(nameRefusal("phone-probe")).toBeNull();
    expect(nameRefusal("1abc")).toContain(NAME_HINT);
    expect(nameRefusal("")).toContain(NAME_HINT);
  });

  it("knows the two templates and starts on empty", () => {
    expect(TEMPLATES).toEqual(["empty", "python"]);
    expect(DEFAULT_TEMPLATE).toBe("empty");
  });
});

const BORN: NewProjectResult = {
  ok: true,
  name: "phone-probe",
  project: "PHONE-PROBE",
  target: "/srv/aipass/projects/phone-probe",
  template: "empty",
  agent: "phone_probe",
  agent_home: "/srv/aipass/projects/phone-probe/src/phone_probe",
  detail: "Project phone-probe created with its manager agent",
};

describe("the manager's card, from the answer", () => {
  it("names the agent in the new project, at its home", () => {
    expect(bornCard(BORN)).toMatchObject({
      name: "phone_probe",
      project: "PHONE-PROBE",
      path: BORN.agent_home,
      manager: true,
    });
  });

  it("reseats on the census name, not the typed one", () => {
    expect(bornSeat(BORN)).toBe("PHONE-PROBE");
  });

  it("offers the door a newborn card offers: fresh", () => {
    expect(roomDoors(bornCard(BORN))[0].mode).toBe("fresh");
  });
});

describe("verb_new_project on the wire", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answers(status: number, body: unknown) {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("window", { localStorage: { getItem: () => "stub-token" } });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("posts the name and template to the new-project verb", async () => {
    const fetch = answers(200, BORN);
    await expect(verbNewProject("phone-probe", "python")).resolves.toEqual(BORN);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/v1/verbs/new-project");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ name: "phone-probe", template: "python" });
  });

  it("carries the server's sentence verbatim on a refusal", async () => {
    const sentence = "Project already exists: /srv/aipass/projects/phone-probe";
    answers(409, { error: { code: "project_exists", message: sentence } });
    await expect(call("verb_new_project", { name: "phone-probe", template: "empty" })).rejects.toMatchObject({
      name: "HostError",
      status: 409,
      code: "project_exists",
      message: sentence,
    });
  });
});
