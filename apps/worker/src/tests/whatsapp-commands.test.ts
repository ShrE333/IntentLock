import {describe,it,expect} from "vitest";
import {parseWhatsappCommand} from "../whatsapp/commands";

describe("WhatsApp command parser",()=>{
  it("parses wallet selection",()=>{
    expect(parseWhatsappCommand("USE 1")).toEqual({
      type:"USE_WALLET",
      selector:"1"
    });
  });

  it("parses step-up approval",()=>{
    expect(parseWhatsappCommand("allow once")).toEqual({
      type:"ALLOW_ONCE"
    });
  });

  it("treats natural language as a purchase goal",()=>{
    const result=parseWhatsappCommand(
      "Find Sony or Bose ANC headphones under 7000"
    );
    expect(result.type).toBe("BUY");
    if(result.type==="BUY"){
      expect(result.prompt).toContain("Sony");
    }
  });
});
