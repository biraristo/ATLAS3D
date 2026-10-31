#!/bin/bash
curl -sS -m 300 -A "Mozilla/5.0 Chrome/130" -X POST "https://discodata.eea.europa.eu/sql" --data-urlencode "query=$1" --data-urlencode "p=${3:-1}" --data-urlencode "nrOfHits=${2:-5}"
