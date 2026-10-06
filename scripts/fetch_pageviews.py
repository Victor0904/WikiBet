#!/usr/bin/env python3
"""Rafraîchit les données de Wiki-Bourse depuis l'API Wikimedia Pageviews.

Usage :
    python scripts/fetch_pageviews.py              # 90 jours jusqu'à hier
    python scripts/fetch_pageviews.py --days 120
    python scripts/fetch_pageviews.py --end 2026-10-04

Écrit data/pageviews.js (prototype) et web/src/pageviews.json (version en ligne,
à envoyer ensuite en base avec `npm run seed` dans web/).
Bibliothèque standard uniquement. Une requête par article, avec une pause
entre chaque pour respecter les limites de l'API (erreur 429 sinon).
"""
import argparse, datetime as dt, json, pathlib, sys, time, urllib.parse, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/{project}/all-access/user/{title}/daily/{start}/{end}"
# Wikimedia demande un User-Agent identifiable avec un moyen de contact.
USER_AGENT = "WikiBourse/0.1 (prototype de jeu ; remplacer par ton e-mail)"


def fetch(project, title, start, end, retries=4):
    url = API.format(project=project, title=urllib.parse.quote(title, safe=""), start=start, end=end)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)["items"]
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                wait = 30 * (attempt + 1)
                print(f"  limite atteinte, pause {wait} s…", file=sys.stderr)
                time.sleep(wait)
                continue
            raise


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=90, help="nombre de jours (au moins 31)")
    p.add_argument("--end", help="dernier jour AAAA-MM-JJ (défaut : hier)")
    p.add_argument("--project", default="fr.wikipedia")
    p.add_argument("--pause", type=float, default=1.5, help="secondes entre deux requêtes")
    a = p.parse_args()
    if a.days < 31:
        sys.exit("Il faut au moins 31 jours (30 séances + la veille).")

    end = dt.date.fromisoformat(a.end) if a.end else dt.date.today() - dt.timedelta(days=1)
    start = end - dt.timedelta(days=a.days - 1)
    s, e = start.strftime("%Y%m%d00"), end.strftime("%Y%m%d00")
    articles = json.loads((ROOT / "scripts" / "articles.json").read_text(encoding="utf-8"))

    views, meta = {}, []
    for art in articles:
        print(f"{art['ticker']:6} {art['title']}")
        try:
            items = fetch(a.project, art["title"], s, e)
        except urllib.error.HTTPError as err:
            print(f"  ignoré (HTTP {err.code})", file=sys.stderr)
            continue
        by_day = {it["timestamp"][:8]: it["views"] for it in items}
        series, d = [], start
        while d <= end:                       # jours sans donnée = 0 vue
            series.append(by_day.get(d.strftime("%Y%m%d"), 0))
            d += dt.timedelta(days=1)
        views[art["title"]] = series
        meta.append([art["ticker"], art["title"], art["name"], art["category"]])
        time.sleep(a.pause)

    if not meta:
        sys.exit("Aucune donnée récupérée.")
    data = {"source": f"Wikimedia Pageviews API, {a.project}, agent=user, daily",
            "start": start.isoformat(), "end": end.isoformat(), "articles": meta, "views": views}
    (ROOT / "web" / "src" / "pageviews.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (ROOT / "data" / "pageviews.js").write_text(
        "// Généré par scripts/fetch_pageviews.py — ne pas éditer à la main.\nwindow.WIKI_DATA = "
        + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"OK : {len(meta)} articles, {start} → {end}")


if __name__ == "__main__":
    main()
