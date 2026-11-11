#!/usr/bin/env python3
"""Render tests for the `login` block of helm/frontend: values -> config.json, and the schema's limits.

WHY: the login screen's branding (installation name, "Request an account" link, logo, copy) is read
from config.json's "login" object (ui/src/context/ConfigContext.tsx), and the chart is the only way an
install writes that file. These render the real chart with `helm template` and parse the ConfigMap's
config.json, so they test what a cluster receives rather than the template text:

- unset, config.json has no "login" object, and the ConfigMap is byte-identical to `login: {}`;
- set, "login" holds exactly the keys that were set, JSON-escaped;
- the schema refuses what the login screen must never get (an empty string, a javascript: link, a
  sixth highlight), and admits the URL forms it should.

USAGE: `python3 scripts/test_chart_login.py` (needs helm and pyyaml). CI: .github/workflows/chart-render.yaml.
"""
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
CHART = ROOT / "helm" / "frontend"

ALL_KEYS = {
    "installationName": "krateo-057",
    "requestAccountUrl": "https://example.com/request-access",
    "logoUrl": "https://example.com/logo.svg",
    "logoAlt": "Example Corp",
    "headline": "Ship platform resources without the YAML toil.",
    "subtitle": "Self-service infrastructure for your developers.",
    "highlights": ["Compose cloud resources", "GitOps reconciliation in real time"],
}


class ChartLogin(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # The committed Chart.yaml carries the release workflow's CHART_VERSION/APP_VERSION
        # placeholders, which helm refuses; lint.yaml rewrites them in place, this renders a copy.
        cls.tmp = pathlib.Path(tempfile.mkdtemp())
        cls.chart = cls.tmp / "frontend"
        shutil.copytree(CHART, cls.chart)
        chart_yaml = cls.chart / "Chart.yaml"
        chart_yaml.write_text(chart_yaml.read_text().replace("CHART_VERSION", "0.0.0").replace("APP_VERSION", "0.0.0"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def helm_template(self, values):
        """(exit status, stdout, stderr) of `helm template` with `values` as a values file (None: none)."""
        args = ["helm", "template", "smoke", str(self.chart)]
        if values is not None:
            values_file = self.tmp / "values.yaml"
            values_file.write_text(yaml.safe_dump(values))
            args += ["-f", str(values_file)]
        done = subprocess.run(args, capture_output=True, text=True)
        return done.returncode, done.stdout, done.stderr

    def config_vars(self, values):
        """The rendered config.json text, failing the test if the render fails."""
        code, out, err = self.helm_template(values)
        self.assertEqual(code, 0, f"helm template failed: {err}")
        maps = [
            doc for doc in yaml.safe_load_all(out)
            if doc and doc.get("kind") == "ConfigMap" and doc["metadata"]["name"].endswith("-config-vars")
        ]
        self.assertEqual(len(maps), 1, "expected exactly one <fullname>-config-vars ConfigMap")
        return maps[0]["data"]["config.json"]

    def config(self, values):
        return json.loads(self.config_vars(values))

    def assert_rejected(self, login, why):
        code, _, err = self.helm_template({"login": login})
        self.assertNotEqual(code, 0, f"schema admitted {why}: {login!r}")
        self.assertIn("schema", err, f"{why}: failed, but not on the schema: {err}")

    # Unset: no "login" object, and nothing else moves.

    def test_unset_renders_no_login_object(self):
        config = self.config(None)
        self.assertEqual(sorted(config), ["api", "params"])

    def test_empty_login_is_byte_identical_to_unset(self):
        self.assertEqual(self.config_vars({"login": {}}), self.config_vars(None))

    # Set: exactly the keys that were set.

    def test_all_keys_render_as_given(self):
        config = self.config({"login": ALL_KEYS})
        self.assertEqual(config["login"], ALL_KEYS)
        self.assertEqual(sorted(config), ["api", "login", "params"])
        self.assertEqual(config["api"], self.config(None)["api"], "login moved an api key")
        self.assertEqual(config["params"], self.config(None)["params"], "login moved a params key")

    def test_only_the_set_keys_render(self):
        for key, value in ALL_KEYS.items():
            with self.subTest(key=key):
                self.assertEqual(self.config({"login": {key: value}})["login"], {key: value})

    def test_null_never_renders(self):
        # helm drops a null from the values; whether it does or the schema refuses it, config.json
        # must never carry "login": {"installationName": null}.
        values = {"login": {"installationName": None, "headline": "Hello"}}
        code, _, err = self.helm_template(values)
        if code == 0:
            self.assertEqual(self.config(values)["login"], {"headline": "Hello"})
        else:
            self.assertIn("schema", err, f"a null failed, but not on the schema: {err}")

    def test_strings_are_json_escaped(self):
        tricky = 'Quote " backslash \\ angle <b> & dot · tab\tend'
        self.assertEqual(self.config({"login": {"headline": tricky}})["login"], {"headline": tricky})

    # The schema's limits.

    def test_empty_strings_are_rejected(self):
        for key in ("installationName", "requestAccountUrl", "logoUrl", "logoAlt", "headline", "subtitle"):
            with self.subTest(key=key):
                self.assert_rejected({key: ""}, "an empty string")

    def test_request_account_url_rejects_other_schemes_and_origins(self):
        for url in (
            "javascript:alert(1)",
            "JAVASCRIPT:alert(1)",
            "data:text/html,hi",
            "http://example.com/access",
            "mailto:access@example.com",
            "//evil.example/access",
            "/\\evil.example/access",
            "https://",
            "https:///path",
            "request-access",
            "/request access",
            " /request-access",
        ):
            with self.subTest(url=url):
                self.assert_rejected({"requestAccountUrl": url}, "a requestAccountUrl")

    def test_request_account_url_admits_https_and_same_origin_paths(self):
        for url in (
            "https://example.com",
            "https://example.com/access?team=platform#form",
            "https://access.example.com:8443/request",
            "/request-access",
            "/",
        ):
            with self.subTest(url=url):
                self.assertEqual(self.config({"login": {"requestAccountUrl": url}})["login"], {"requestAccountUrl": url})

    def test_highlights_limits(self):
        self.assert_rejected({"highlights": [f"Highlight {n}" for n in range(6)]}, "six highlights")
        self.assert_rejected({"highlights": ["ok", ""]}, "an empty highlight")
        self.assert_rejected({"highlights": ["x" * 121]}, "a 121-character highlight")
        self.assert_rejected({"highlights": "one string"}, "highlights as a string")
        five = [f"Highlight {n}" for n in range(4)] + ["x" * 120]
        self.assertEqual(self.config({"login": {"highlights": five}})["login"], {"highlights": five})

    def test_unknown_and_mistyped_keys_are_rejected(self):
        self.assert_rejected({"installationname": "krateo-057"}, "a misspelt key")
        self.assert_rejected({"installationName": 57}, "a number")


if __name__ == "__main__":
    unittest.main(verbosity=2)
