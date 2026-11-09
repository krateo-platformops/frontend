# Stands in for snowplow's operator module (helm/snowplow/assets/custom-modules.jq, mounted from the
# ConfigMap snowplow-jq-custom-modules at JQ_MODULES_PATH). Same name and signature; the body is not
# what these tests check — that `include "custom"` resolves only when the directory is there.
def update_string_schema_defaults($jsonSchemaString; $jsonValues; $enumMap): $jsonSchemaString;
