import sqlite3

path = r"E:\Resources\Serpent\绘画资源库\.serpent\library.db"
c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
cur = c.cursor()
print("assets", cur.execute("select count(*) from assets").fetchone()[0])
print("jobs")
for row in cur.execute(
    "select status, kind, count(*) from jobs group by status, kind order by status, kind"
):
    print(" ", row)
print("artifacts")
for row in cur.execute(
    "select kind, status, count(*) from revision_artifacts group by kind, status order by count(*) desc"
):
    print(" ", row)
c.close()
