#pragma once

#include <string>

namespace hive::gtk_settings {
struct ButtonRaster {
  int width = 0;
  int height = 0;
  std::string states[4];
  std::string backdrop_states[4];
};
}  // namespace hive::gtk_settings
