#pragma once

#include <cstdio>
#include <iostream>
#include <string>
#include <vector>

#include "gtk-settings-model.hpp"

namespace hive::gtk_settings {
// Serialize the GTK settings helper's stable JSON response.
static std::string json_quote(const char *value) {
  std::string result = "\"";
  if (value) {
    for (const unsigned char c : std::string(value)) {
      switch (c) {
        case '"': result += "\\\""; break;
        case '\\': result += "\\\\"; break;
        case '\b': result += "\\b"; break;
        case '\f': result += "\\f"; break;
        case '\n': result += "\\n"; break;
        case '\r': result += "\\r"; break;
        case '\t': result += "\\t"; break;
        default:
          if (c < 0x20) {
            char escaped[7];
            std::snprintf(escaped, sizeof(escaped), "\\u%04x", c);
            result += escaped;
          } else {
            result += static_cast<char>(c);
          }
      }
    }
  }
  result += '"';
  return result;
}

static std::string json_array(const std::vector<std::string> &items) {
  std::string output = "[";
  for (size_t i = 0; i < items.size(); ++i) {
    if (i) output += ',';
    output += json_quote(items[i].c_str());
  }
  output += ']';
  return output;
}

static std::string button_raster_json(const ButtonRaster &raster) {
  const char *state_names[] = {"normal", "hover", "active", "disabled"};
  std::string output = "{\"width\":" + std::to_string(raster.width) +
      ",\"height\":" + std::to_string(raster.height);
  for (size_t i = 0; i < 4; ++i) {
    output += "," + json_quote(state_names[i]) + ":" + json_quote(raster.states[i].c_str());
  }
  output += ",\"backdrop\":{";
  for (size_t i = 0; i < 4; ++i) {
    if (i) output += ',';
    output += json_quote(state_names[i]) + ":" + json_quote(raster.backdrop_states[i].c_str());
  }
  output += '}';
  output += '}';
  return output;
}

static void emit_fallback() {
  const ButtonRaster empty;
  std::cout << "{\"gtk\":{\"version\":3,\"theme\":\"\",\"iconTheme\":\"\",\"font\":\"\",\"fontFamily\":\"\",\"dark\":false}"
            << ",\"window\":{\"decorationLayout\":{\"layout\":\"menu:minimize,maximize,close\",\"left\":[\"menu\"],\"right\":[\"minimize\",\"maximize\",\"close\"]}}"
            << ",\"icons\":{\"menu\":\"\"}"
            << ",\"titleButtons\":{\"spacing\":3,\"minimize\":" << button_raster_json(empty)
            << ",\"maximize\":" << button_raster_json(empty)
            << ",\"restore\":" << button_raster_json(empty)
            << ",\"close\":" << button_raster_json(empty) << '}'
            << ",\"button\":{\"normal\":{\"foreground\":\"#202020\",\"background\":\"transparent\"}"
            << ",\"hover\":{\"foreground\":\"#202020\",\"background\":\"rgba(0,0,0,0.08)\"}"
            << ",\"active\":{\"foreground\":\"#202020\",\"background\":\"rgba(0,0,0,0.15)\"}"
            << ",\"disabled\":{\"foreground\":\"#808080\",\"background\":\"transparent\"}}"
            << ",\"headerbar\":{\"background\":\"#eeeeec\",\"foreground\":\"#202020\",\"height\":46}}"
            << std::endl;
}
}  // namespace hive::gtk_settings
