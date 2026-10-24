"""Slowly fetch the descriptions LinkedIn jobs are missing, from LinkedIn's light guest endpoint (the one the public job page loads).

Why: the scraper's own backfill loads the full page for 100+ jobs every run, gets 429 on all of them, and keeps the address throttled.
This one asks for at most LIMIT jobs, one every few seconds, and stops at the first 429 so the address can cool down.
Each job is tried at most MAX_TRIES times (kept in the linkedin_desc_tries collection), so a job LinkedIn will not give is dropped.
Reads MONGO_URI from the environment. Writes only the descriptions collection and linkedin_desc_tries.
"""
import os
import random
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from bs4 import BeautifulSoup
from pymongo import MongoClient, UpdateOne

LIMIT = int(os.environ.get("LI_DESC_LIMIT", "40"))
MAX_TRIES = 3
MIN_CHARS = 200
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
GUEST = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{id}"


def job_id(url: str):
    m = re.search(r"(\d{8,})", url or "")
    return m.group(1) if m else None


def parse(html: str) -> str:
    box = BeautifulSoup(html, "html.parser").select_one(".show-more-less-html__markup, .description__text")
    return box.get_text("\n", strip=True) if box else ""


def main() -> int:
    db = MongoClient(os.environ["MONGO_URI"], serverSelectionTimeoutMS=20000)["job_pipeline"]
    since = datetime.now(timezone.utc) - timedelta(days=3)
    jobs = list(db.jobs.find({"site": "linkedin", "run_at": {"$gte": since}}, {"job_url": 1}).sort("run_at", -1))
    urls = list(dict.fromkeys(j["job_url"] for j in jobs if j.get("job_url")))
    have = {d["job_url"] for d in db.descriptions.find({"job_url": {"$in": urls}}, {"job_url": 1, "description": 1}) if len(d.get("description") or "") >= MIN_CHARS}
    tries = {t["_id"]: t["n"] for t in db.linkedin_desc_tries.find({"_id": {"$in": urls}})}
    todo = [u for u in urls if u not in have and tries.get(u, 0) < MAX_TRIES and job_id(u)][:LIMIT]
    print(f"{len(urls)} LinkedIn jobs from the last 3 days; {len(urls) - len(have)} lack text; trying {len(todo)}")
    got = 0
    for u in todo:
        try:
            r = requests.get(GUEST.format(id=job_id(u)), headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}, timeout=20)
        except requests.RequestException as e:
            print(f"  network error ({e.__class__.__name__}); stopping")
            break
        if r.status_code == 429:
            print("  LinkedIn asked to slow down (429); stopping until the next run")
            break
        text = parse(r.text) if r.status_code == 200 else ""
        db.linkedin_desc_tries.update_one({"_id": u}, {"$inc": {"n": 1}, "$set": {"last": datetime.now(timezone.utc)}}, upsert=True)
        if len(text) >= MIN_CHARS:
            db.descriptions.update_one({"job_url": u}, {"$set": {"job_url": u, "description": text}}, upsert=True)
            got += 1
        time.sleep(random.uniform(2.5, 4.5))
    print(f"filled {got} of {len(todo)} descriptions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
