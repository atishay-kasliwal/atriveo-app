"""Build-time fix for job-pipeline's Mongo writer (run once, in the image build, from the repo checkout).

JobSpy returns plain datetime.date values (date_posted). The pipeline's _mongo_value converts pandas Timestamps but not dates, so
pymongo raised "cannot encode object: datetime.date(...)" and every scrape was scored and saved to files but never written to Mongo
("MongoDB insert failed (non-fatal)"). Dates are stored as ISO strings, the way the board sources already store date_posted.

The build FAILS if the code no longer looks like this (an upstream change or an upstream fix): look, then adjust or drop this patch.
"""
import pathlib
import sys

path = pathlib.Path("job_pipeline/storage.py")
src = path.read_text()
if "isinstance(value, _date)" in src:
    print("storage.py already handles dates; nothing to do")
    sys.exit(0)

imp = "from datetime import datetime, timezone\n"
marker = "    if isinstance(value, np.generic):\n        return _mongo_value(value.item())\n    return value\n"
if imp not in src or marker not in src:
    sys.exit("patch_storage.py: job_pipeline/storage.py changed shape; review deploy/scraper/patch_storage.py")

src = src.replace(imp, "from datetime import date as _date, datetime, timezone\n", 1)
src = src.replace(
    marker,
    "    if isinstance(value, np.generic):\n        return _mongo_value(value.item())\n"
    "    if isinstance(value, _date) and not isinstance(value, datetime):\n"
    "        return value.isoformat()  # plain dates (JobSpy date_posted): Mongo cannot encode them\n"
    "    return value\n",
    1,
)
path.write_text(src)
print("patched job_pipeline/storage.py: datetime.date -> ISO string")
