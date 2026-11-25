#!/bin/bash
while true; do l=$(sysctl -n vm.loadavg | awk '{print $2}'); if awk "BEGIN{exit !($l < 90)}"; then echo "load $l"; break; fi; echo "load $l, waiting"; sleep 60; done
