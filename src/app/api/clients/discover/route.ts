export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";


// Extract all href values from HTML
function extractHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const regex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    let url = match[1];
    // Decode HTML entities
    url = url.replace(/&amp;/g, "&").replace(/&#x2F;/g, "/").replace(/&#47;/g, "/");
    hrefs.push(url);
  }
  return hrefs;
}


// Platform detection from URLs
const PLATFORM_MATCHERS: { platform: string; test: (url: string) => boolean; clean: (url: string) => string }[] = [
  {
    platform: "LINKEDIN",
    test: (url) => /linkedin\.com\/(company|in|school)\/[a-zA-Z0-9_-]+/i.test(url),
    clean: (url) => {
      const m = url.match(/(https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in|school)\/[a-zA-Z0-9_-]+)\/?/i);
      return m ? m[1] : url;
    },
  },
  {
    platform: "TWITTER",
    test: (url) => {
      if (!/((?:^|:\/\/|:\/\/www\.)?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+/i.test(url)) return false;
      // Exclude share/intent/generic pages
      return !/\/(intent|share|sharer|login|signup|help|i\/|search|hashtag)\b/i.test(url);
    },
    clean: (url) => {
      const m = url.match(/(https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+)\/?/i);
      return m ? m[1] : url;
    },
  },
  {
    platform: "GOOGLE_BUSINESS",
    test: (url) =>
      /google\.com\/maps\/place\//i.test(url) ||
      /g\.page\//i.test(url) ||
      /business\.google\.com/i.test(url),
    clean: (url) => url.split("?")[0],
  },
  {
    platform: "FACEBOOK",
    test: (url) => {
      if (!/(?:facebook\.com|fb\.com)\/[a-zA-Z0-9._-]+/i.test(url)) return false;
      return !/\/(sharer|share|dialog|plugins|login|help)\b/i.test(url);
    },
    clean: (url) => {
      const m = url.match(/(https?:\/\/(?:www\.)?(?:facebook\.com|fb\.com)\/[a-zA-Z0-9._-]+)\/?/i);
      return m ? m[1] : url;
    },
  },
  {
    platform: "INSTAGRAM",
    test: (url) => {
      if (!/instagram\.com\/[a-zA-Z0-9._]+/i.test(url)) return false;
      return !/\/(explore|reels|stories|accounts|developer|legal)\b/i.test(url);
    },
    clean: (url) => {
      const m = url.match(/(https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+)\/?/i);
      return m ? m[1] : url;
    },
  },
  {
