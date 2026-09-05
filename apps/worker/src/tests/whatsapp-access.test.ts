import {describe,it,expect} from "vitest";
import {
  extractPairingCode,
  pairingCodeMatches,
  isWhatsappStopCommand
} from "../whatsapp/access";

describe("V10.8 WhatsApp access gate",()=>{
  it("extracts only explicit IntentLock pairing commands",()=>{
    expect(extractPairingCode("INTENTLOCK abcdef123456"))
      .toBe("abcdef123456");
    expect(extractPairingCode("hello")).toBe(null);
    expect(extractPairingCode("buy headphones")).toBe(null);
  });

  it("requires the exact configured pairing code",()=>{
    expect(pairingCodeMatches("abc12345","abc12345")).toBe(true);
    expect(pairingCodeMatches("abc12345","wrong123")).toBe(false);
  });

  it("recognizes explicit revocation",()=>{
    expect(isWhatsappStopCommand("INTENTLOCK STOP")).toBe(true);
    expect(isWhatsappStopCommand("STOP INTENTLOCK")).toBe(true);
    expect(isWhatsappStopCommand("STOP")).toBe(false);
  });
});
