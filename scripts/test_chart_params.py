#!/usr/bin/env python3
"""Render tests for the "params" object of helm/frontend's config.json.

WHY: the SPA reads config.params (ui/src/context/ConfigContext.tsx), and the chart is the only way an
install writes it. These render the real chart with `helm template` and parse the ConfigMap's
config.json, so they test what a cluster receives rather than the template text:

- PUBLIC_NAMESPACE, the namespace a short public address (/public/<slug>) reads its page from, is
  the `publicNamespace` value: krateo-public by default, the value when one is set, and "" (still
  valid JSON) when values remove it;
- the schema refuses a `publicNamespace` that is not a namespace name;
- FRONTEND_NAMESPACE stays the release namespace.

USAGE: `python3 scripts/test_chart_params.py` (needs helm and pyyaml). CI: .github/workflows/chart-render.yaml.
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


class ChartParams(unittest.TestCase):
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

    def helm_template(self, values, namespace="krateo-system"):
        """(exit status, stdout, stderr) of `helm template` with `values` as a values file (None: none)."""
        args = ["helm", "template", "smoke", str(self.chart), "--namespace", namespace]
        if values is not None:
            values_file = self.tmp / "values.yaml"
            values_file.write_text(yaml.safe_dump(values))
            args += ["-f", str(values_file)]
        done = subprocess.run(args, capture_output=True, text=True)
        return done.returncode, done.stdout, done.stderr

    def params(self, values):
        """config.json's "params" object, failing the test if the render fails or is not JSON."""
        code, out, err = self.helm_template(values)
        self.assertEqual(code, 0, f"helm template failed: {err}")
        maps = [
            doc for doc in yaml.safe_load_all(out)
            if doc and doc.get("kind") == "ConfigMap" and doc["metadata"]["name"].endswith("-config-vars")
        ]
        self.assertEqual(len(maps), 1, "expected exactly one <fullname>-config-vars ConfigMap")
        return json.loads(maps[0]["data"]["config.json"])["params"]

    def test_public_namespace_defaults_to_krateo_public(self):
        self.assertEqual(self.params(None)["PUBLIC_NAMESPACE"], "krateo-public")

    def test_public_namespace_is_the_value_when_set(self):
        self.assertEqual(self.params({"publicNamespace": "team-public"})["PUBLIC_NAMESPACE"], "team-public")

    def test_public_namespace_removed_renders_empty_and_valid_json(self):
        # A null in a values file deletes the key: the template must still write valid JSON, and
        # the SPA reads "" as "no public-pages namespace".
        self.assertEqual(self.params({"publicNamespace": None})["PUBLIC_NAMESPACE"], "")

    def test_schema_refuses_a_public_namespace_that_is_not_a_namespace_name(self):
        for bad in ["", "Krateo-Public", "krateo_public", "-krateo", "a" * 64]:
            code, _, _ = self.helm_template({"publicNamespace": bad})
            self.assertNotEqual(code, 0, f"schema admitted publicNamespace {bad!r}")

    def test_frontend_namespace_stays_the_release_namespace(self):
        params = self.params(None)
        self.assertEqual(params["FRONTEND_NAMESPACE"], "krateo-system")
        self.assertEqual(params["DELAY_SAVE_NOTIFICATION"], "10000")


if __name__ == "__main__":
    unittest.main()
