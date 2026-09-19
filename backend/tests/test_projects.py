async def test_project_crud(client, make_user):
    user = await make_user()
    h = user["headers"]

    created = await client.post("/projects", json={"topic": "graph neural networks"}, headers=h)
    assert created.status_code == 201
    project = created.json()
    assert project["title"] == "Research: graph neural networks"
    assert project["status"] == "pending"

    listed = await client.get("/projects", headers=h)
    assert listed.json()["total"] == 1

    got = await client.get(f"/projects/{project['id']}", headers=h)
    assert got.status_code == 200

    deleted = await client.delete(f"/projects/{project['id']}", headers=h)
    assert deleted.status_code == 204


async def test_project_delete_is_persisted(client, make_user, make_project):
    """Regression: 204 deletes used to be rolled back (see decisions.md D-12)."""
    user = await make_user()
    h = user["headers"]
    pid = await make_project(user)

    await client.delete(f"/projects/{pid}", headers=h)

    assert (await client.get(f"/projects/{pid}", headers=h)).status_code == 404
    assert (await client.get("/projects", headers=h)).json()["total"] == 0


async def test_projects_are_scoped_to_owner(client, make_user, make_project):
    alice = await make_user()
    bob = await make_user()
    pid = await make_project(alice)

    assert (await client.get("/projects", headers=bob["headers"])).json()["total"] == 0
    assert (await client.get(f"/projects/{pid}", headers=bob["headers"])).status_code == 404
    assert (await client.delete(f"/projects/{pid}", headers=bob["headers"])).status_code == 404


async def test_projects_require_auth(client):
    assert (await client.get("/projects")).status_code == 401
    assert (await client.post("/projects", json={"topic": "x"})).status_code == 401


async def test_api_responses_carry_security_headers(client, make_user):
    user = await make_user()
    resp = await client.get("/projects", headers=user["headers"])
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["cache-control"] == "no-store"
    assert resp.headers["content-security-policy"].startswith("default-src 'none'")


async def test_project_list_counts_papers(client, make_user, make_project):
    from app.db.session import AsyncSessionLocal
    from app.models.models import Paper

    user = await make_user()
    with_papers = await make_project(user)
    empty = await make_project(user)
    async with AsyncSessionLocal() as db:
        db.add_all([Paper(project_id=with_papers, title=f"P{i}") for i in range(3)])
        await db.commit()

    listed = (await client.get("/projects", headers=user["headers"])).json()["projects"]
    counts = {p["id"]: p["paper_count"] for p in listed}
    assert counts == {with_papers: 3, empty: 0}
