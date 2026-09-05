import {describe,it,expect} from "vitest";
import {
  extractPairingCode,
  pairingCodeMatches,
  isStaleWhatsappMessage
} from "../whatsapp/access";

describe("V10.8.1 WhatsApp safety hotfix",()=>{
  it("recognizes an exact pairing command",()=>{
    const supplied=extractPairingCode(
      "INTENTLOCK abcdef1234567890"
    );

    expect(supplied).toBe("abcdef1234567890");
    expect(
      pairingCodeMatches(
        supplied,
        "abcdef1234567890"
      )
    ).toBe(true);
  });

  it("rejects historical backlog messages",()=>{
    const now=1_800_000_000_000;
    const tenMinutesAgo=(now-10*60*1000)/1000;

    expect(
      isStaleWhatsappMessage(
        undefined,
        tenMinutesAgo,
        now,
        5*60*1000
      )
    ).toBe(true);
  });

  it("accepts fresh incoming messages",()=>{
    const now=1_800_000_000_000;
    const thirtySecondsAgo=(now-30*1000)/1000;

    expect(
      isStaleWhatsappMessage(
        undefined,
        thirtySecondsAgo,
        now,
        5*60*1000
      )
    ).toBe(false);
  });
});
