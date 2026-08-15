import { describe, expect, it } from "vitest";
import { youtubeEmbedUrl } from "./youtube.js";

describe("youtubeEmbedUrl", () => {
  it("parses watch, share, live, and embed links", () => {
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0"
    );
    expect(youtubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toContain("dQw4w9WgXcQ");
    expect(youtubeEmbedUrl("https://www.youtube.com/live/dQw4w9WgXcQ")).toContain("dQw4w9WgXcQ");
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toContain("dQw4w9WgXcQ");
  });

  it("rejects junk", () => {
    expect(youtubeEmbedUrl("https://example.com")).toBeNull();
    expect(youtubeEmbedUrl("")).toBeNull();
  });
});
