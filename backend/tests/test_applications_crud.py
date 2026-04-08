"""
CRUD endpoint tests for /api/applications.
Uses the test client with SQLite in-memory DB and mocked JWT auth.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.models.application import Application, StatusHistory
from app.models.user import User


pytestmark = pytest.mark.asyncio


async def _create_app_payload(**kwargs) -> dict:
    """Build a minimal valid ApplicationCreate payload."""
    return {
        "company": kwargs.get("company", "Acme Corp"),
        "job_title": kwargs.get("job_title", "Software Engineer"),
        "status": kwargs.get("status", "applied"),
        "date_applied": kwargs.get("date_applied", date.today().isoformat()),
        "source": kwargs.get("source", "linkedin"),
        "skills": kwargs.get("skills", ["python", "fastapi"]),
    }


class TestCreateApplication:
    async def test_create_returns_201(self, client: AsyncClient, auth_headers: dict):
        payload = await _create_app_payload()
        resp = await client.post("/api/applications", json=payload, headers=auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["company"] == "Acme Corp"
        assert data["job_title"] == "Software Engineer"
        assert "id" in data

    async def test_create_records_initial_status_history(
        self, client: AsyncClient, auth_headers: dict
    ):
        payload = await _create_app_payload()
        resp = await client.post("/api/applications", json=payload, headers=auth_headers)
        data = resp.json()
        assert len(data["status_history"]) >= 1
        assert data["status_history"][0]["to_status"] == "applied"
        assert data["status_history"][0]["from_status"] is None

    async def test_create_upserts_skills(self, client: AsyncClient, auth_headers: dict):
        payload = await _create_app_payload(skills=["python", "docker", "python"])
        resp = await client.post("/api/applications", json=payload, headers=auth_headers)
        data = resp.json()
        # Deduplicated
        assert "python" in data["skills"]
        assert "docker" in data["skills"]

    async def test_create_requires_auth(self, client: AsyncClient):
        payload = await _create_app_payload()
        resp = await client.post("/api/applications", json=payload)
        assert resp.status_code == 403


class TestListApplications:
    async def test_list_returns_own_apps(self, client: AsyncClient, auth_headers: dict):
        # Create 2 applications
        for i in range(2):
            payload = await _create_app_payload(company=f"Company {i}")
            await client.post("/api/applications", json=payload, headers=auth_headers)

        resp = await client.get("/api/applications", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert data["total"] >= 2

    async def test_list_filter_by_status(self, client: AsyncClient, auth_headers: dict):
        await client.post(
            "/api/applications",
            json=await _create_app_payload(company="Rejected Co", status="rejected"),
            headers=auth_headers,
        )
        resp = await client.get(
            "/api/applications?status=rejected", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert all(item["status"] == "rejected" for item in data["items"])

    async def test_list_search(self, client: AsyncClient, auth_headers: dict):
        await client.post(
            "/api/applications",
            json=await _create_app_payload(company="UniqueSearchCompany"),
            headers=auth_headers,
        )
        resp = await client.get(
            "/api/applications?search=UniqueSearch", headers=auth_headers
        )
        data = resp.json()
        assert any("UniqueSearchCompany" in item["company"] for item in data["items"])


class TestGetApplication:
    async def test_get_returns_detail(self, client: AsyncClient, auth_headers: dict):
        payload = await _create_app_payload()
        created = (
            await client.post("/api/applications", json=payload, headers=auth_headers)
        ).json()
        app_id = created["id"]

        resp = await client.get(f"/api/applications/{app_id}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == app_id

    async def test_get_returns_404_for_unknown(
        self, client: AsyncClient, auth_headers: dict
    ):
        resp = await client.get(
            f"/api/applications/{uuid.uuid4()}", headers=auth_headers
        )
        assert resp.status_code == 404


class TestUpdateApplication:
    async def test_patch_status_creates_history(
        self, client: AsyncClient, auth_headers: dict
    ):
        payload = await _create_app_payload()
        created = (
            await client.post("/api/applications", json=payload, headers=auth_headers)
        ).json()
        app_id = created["id"]

        resp = await client.patch(
            f"/api/applications/{app_id}",
            json={"status": "screening"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "screening"
        # Should have 2 history entries: initial + the transition
        assert len(data["status_history"]) >= 2
        transitions = [h["to_status"] for h in data["status_history"]]
        assert "screening" in transitions

    async def test_patch_updates_scalar_fields(
        self, client: AsyncClient, auth_headers: dict
    ):
        payload = await _create_app_payload()
        created = (
            await client.post("/api/applications", json=payload, headers=auth_headers)
        ).json()
        app_id = created["id"]

        resp = await client.patch(
            f"/api/applications/{app_id}",
            json={"notes": "Great team!", "salary_min": 9000000},
            headers=auth_headers,
        )
        data = resp.json()
        assert data["notes"] == "Great team!"
        assert data["salary_min"] == 9000000


class TestDeleteApplication:
    async def test_delete_returns_204(self, client: AsyncClient, auth_headers: dict):
        payload = await _create_app_payload()
        created = (
            await client.post("/api/applications", json=payload, headers=auth_headers)
        ).json()
        app_id = created["id"]

        resp = await client.delete(
            f"/api/applications/{app_id}", headers=auth_headers
        )
        assert resp.status_code == 204

    async def test_deleted_app_not_returned_in_list(
        self, client: AsyncClient, auth_headers: dict
    ):
        payload = await _create_app_payload(company="DeleteMe Corp")
        created = (
            await client.post("/api/applications", json=payload, headers=auth_headers)
        ).json()
        app_id = created["id"]

        await client.delete(f"/api/applications/{app_id}", headers=auth_headers)

        resp = await client.get(
            "/api/applications?search=DeleteMe", headers=auth_headers
        )
        data = resp.json()
        assert not any(item["id"] == app_id for item in data["items"])
