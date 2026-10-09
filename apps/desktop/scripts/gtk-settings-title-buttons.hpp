#pragma once

#include <gtk/gtk.h>

#include <algorithm>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

#include "gtk-settings-model.hpp"
#include "gtk-settings-rendering.hpp"

namespace hive::gtk_settings {
// Traversal and raster capture for GTK header-bar title buttons.
namespace fs = std::filesystem;

struct TitleButtons {
  GtkWidget *minimize = nullptr;
  GtkWidget *maximize = nullptr;
  GtkWidget *close = nullptr;
  int spacing = 3;
  bool has_spacing = false;
};

static void collect_title_buttons(GtkWidget *widget, gpointer data);

static fs::path find_theme_title_button_assets(const char *theme_name) {
  if (!theme_name || !*theme_name) return {};

  std::vector<fs::path> theme_roots;
  if (const char *user_data = g_get_user_data_dir()) {
    theme_roots.emplace_back(fs::path(user_data) / "themes");
  }
  if (const char *home = g_get_home_dir()) {
    theme_roots.emplace_back(fs::path(home) / ".themes");
  }
  const char *const *system_data_dirs = g_get_system_data_dirs();
  if (system_data_dirs) {
    for (size_t i = 0; system_data_dirs[i]; ++i) {
      theme_roots.emplace_back(fs::path(system_data_dirs[i]) / "themes");
    }
  }

  const fs::path asset_subdirectories[] = {
      fs::path("gtk-3.0") / "windows-assets",
      fs::path("gtk-3.0") / "assets",
      fs::path("gtk-3.0"),
  };
  for (const auto &root : theme_roots) {
    for (const auto &subdirectory : asset_subdirectories) {
      const fs::path candidate = root / theme_name / subdirectory;
      std::error_code error;
      if (fs::is_directory(candidate, error)) return candidate;
    }
  }
  return {};
}

static std::vector<std::string> title_button_asset_names(const char *button,
                                                         bool backdrop,
                                                         size_t state,
                                                         bool dark) {
  if (!button || state == 3) return {};

  std::vector<std::string> state_suffixes;
  if (state == 0) {
    state_suffixes = backdrop ? std::vector<std::string>{"-backdrop", ""}
                              : std::vector<std::string>{""};
  } else if (state == 1) {
    state_suffixes = backdrop ? std::vector<std::string>{"-backdrop-hover", "-backdrop"}
                              : std::vector<std::string>{"-hover", ""};
  } else if (state == 2) {
    state_suffixes = backdrop ? std::vector<std::string>{"-backdrop-active", "-backdrop-hover", "-backdrop"}
                              : std::vector<std::string>{"-active", ""};
  }

  std::vector<std::string> filenames;
  filenames.reserve(state_suffixes.size());
  for (const auto &suffix : state_suffixes) {
    filenames.emplace_back(std::string("titlebutton-") + button + suffix + (dark ? "-dark" : "") + ".png");
  }
  return filenames;
}

static std::string title_button_asset_data_uri(const fs::path &asset_directory,
                                               const char *button,
                                               bool backdrop,
                                               size_t state,
                                               bool dark,
                                               int scale) {
  if (asset_directory.empty()) return "";
  for (const auto &filename : title_button_asset_names(button, backdrop, state, dark)) {
    if (scale >= 2) {
      const std::string scaled_filename = filename.substr(0, filename.size() - 4) + "@2.png";
      GError *error = nullptr;
      GdkPixbuf *pixbuf = gdk_pixbuf_new_from_file((asset_directory / scaled_filename).c_str(), &error);
      if (pixbuf) {
        const std::string image = pixbuf_data_uri(pixbuf);
        g_object_unref(pixbuf);
        return image;
      }
      if (error) g_clear_error(&error);
    }

    GError *error = nullptr;
    GdkPixbuf *pixbuf = gdk_pixbuf_new_from_file((asset_directory / filename).c_str(), &error);
    if (pixbuf) {
      const std::string image = pixbuf_data_uri(pixbuf);
      g_object_unref(pixbuf);
      return image;
    }
    if (error) g_clear_error(&error);
  }
  return "";
}

static void apply_theme_title_button_assets(const fs::path &asset_directory,
                                            const char *button,
                                            ButtonRaster *raster,
                                            bool dark,
                                            int scale) {
  if (!raster || asset_directory.empty()) return;
  for (size_t state = 0; state < 3; ++state) {
    const auto normal_image = title_button_asset_data_uri(asset_directory, button, false, state, dark, scale);
    if (!normal_image.empty()) raster->states[state] = normal_image;
    const auto backdrop_image = title_button_asset_data_uri(asset_directory, button, true, state, dark, scale);
    if (!backdrop_image.empty()) raster->backdrop_states[state] = backdrop_image;
  }
}

static void clear_backdrop_state(GtkWidget *widget, gpointer) {
  if (!widget) return;
  gtk_widget_unset_state_flags(widget, GTK_STATE_FLAG_BACKDROP);
  if (GTK_IS_CONTAINER(widget)) {
    gtk_container_forall(GTK_CONTAINER(widget), clear_backdrop_state, nullptr);
  }
}

static void set_backdrop_state(GtkWidget *widget, gpointer) {
  if (!widget) return;
  gtk_widget_set_state_flags(widget, GTK_STATE_FLAG_BACKDROP, FALSE);
  if (GTK_IS_CONTAINER(widget)) {
    gtk_container_forall(GTK_CONTAINER(widget), set_backdrop_state, nullptr);
  }
}

static void visit_child(GtkWidget *widget, gpointer data) {
  collect_title_buttons(widget, data);
}

static void collect_title_buttons(GtkWidget *widget, gpointer data) {
  auto *buttons = static_cast<TitleButtons *>(data);
  if (GTK_IS_BUTTON(widget)) {
    GtkStyleContext *context = gtk_widget_get_style_context(widget);
    if (gtk_style_context_has_class(context, "minimize")) buttons->minimize = widget;
    if (gtk_style_context_has_class(context, "maximize")) buttons->maximize = widget;
    if (gtk_style_context_has_class(context, "close")) buttons->close = widget;
    GtkWidget *parent = gtk_widget_get_parent(widget);
    if (!buttons->has_spacing && GTK_IS_BOX(parent)) {
      buttons->spacing = gtk_box_get_spacing(GTK_BOX(parent));
      buttons->has_spacing = true;
    }
  }
  if (GTK_IS_CONTAINER(widget)) {
    gtk_container_forall(GTK_CONTAINER(widget), visit_child, data);
  }
}

static GtkWidget *find_first_image(GtkWidget *widget);

static void find_image_child(GtkWidget *widget, gpointer data) {
  auto **result = static_cast<GtkWidget **>(data);
  if (!*result) *result = find_first_image(widget);
}

static GtkWidget *find_first_image(GtkWidget *widget) {
  if (GTK_IS_IMAGE(widget)) return widget;
  if (GTK_IS_CONTAINER(widget)) {
    GtkWidget *result = nullptr;
    gtk_container_forall(GTK_CONTAINER(widget), find_image_child, &result);
    return result;
  }
  return nullptr;
}

static cairo_surface_t *render_window(GtkWidget *window, int *scale_out) {
  GtkAllocation allocation{};
  gtk_widget_get_allocation(window, &allocation);
  const int scale = std::max(1, gtk_widget_get_scale_factor(window));
  const int width = std::max(1, allocation.width);
  const int height = std::max(1, allocation.height);
  cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, width * scale, height * scale);
  cairo_t *cr = cairo_create(surface);
  cairo_scale(cr, scale, scale);
  const double window_opacity = gtk_widget_get_opacity(window);
  gtk_widget_set_opacity(window, 1.0);
  if (GTK_IS_CONTAINER(window)) gtk_container_check_resize(GTK_CONTAINER(window));
  gtk_widget_draw(window, cr);
  gtk_widget_set_opacity(window, window_opacity);
  cairo_destroy(cr);
  cairo_surface_flush(surface);

  *scale_out = scale;
  return surface;
}

static std::string crop_widget_data_uri(cairo_surface_t *surface, GtkWidget *window, GtkWidget *widget, int scale) {
  if (!widget || !gtk_widget_get_visible(widget)) return "";
  GtkAllocation allocation{};
  gtk_widget_get_allocation(widget, &allocation);
  if (allocation.width <= 0 || allocation.height <= 0) return "";

  gint x = 0;
  gint y = 0;
  if (!gtk_widget_translate_coordinates(widget, window, 0, 0, &x, &y)) return "";
  const int pixel_x = x * scale;
  const int pixel_y = y * scale;
  const int pixel_width = allocation.width * scale;
  const int pixel_height = allocation.height * scale;
  GdkPixbuf *pixbuf = gdk_pixbuf_get_from_surface(surface, pixel_x, pixel_y, pixel_width, pixel_height);
  const std::string result = pixbuf_data_uri(pixbuf);
  if (pixbuf) g_object_unref(pixbuf);
  return result;
}

static void set_title_button_state(GtkWidget *widget, GtkStateFlags state, bool disabled) {
  if (!widget) return;
  gtk_widget_set_sensitive(widget, !disabled);
  if (!disabled) gtk_widget_set_state_flags(widget, state, TRUE);
}

static void capture_button_variants(GtkWidget *window,
                                    const std::vector<std::pair<const char *, GtkWidget *>> &widgets,
                                    std::vector<ButtonRaster> *rasters,
                                    bool backdrop) {
  const GtkStateFlags state_flags[] = {
      GTK_STATE_FLAG_NORMAL,
      GTK_STATE_FLAG_PRELIGHT,
      static_cast<GtkStateFlags>(GTK_STATE_FLAG_PRELIGHT | GTK_STATE_FLAG_ACTIVE),
      GTK_STATE_FLAG_NORMAL,
  };
  const bool disabled[] = {false, false, false, true};

  for (size_t state = 0; state < 4; ++state) {
    for (const auto &entry : widgets) {
      set_title_button_state(entry.second, state_flags[state], disabled[state]);
    }
    if (backdrop) set_backdrop_state(window, nullptr);
    else clear_backdrop_state(window, nullptr);
    gtk_widget_queue_draw(window);
    while (g_main_context_iteration(nullptr, FALSE)) {}
    if (GTK_IS_CONTAINER(window)) gtk_container_check_resize(GTK_CONTAINER(window));
    while (g_main_context_iteration(nullptr, FALSE)) {}

    int scale = 1;
    cairo_surface_t *surface = render_window(window, &scale);
    for (size_t i = 0; i < widgets.size(); ++i) {
      GtkWidget *widget = widgets[i].second;
      if (!widget) continue;
      GtkAllocation allocation{};
      gtk_widget_get_allocation(widget, &allocation);
      (*rasters)[i].width = allocation.width;
      (*rasters)[i].height = allocation.height;
      const auto image = crop_widget_data_uri(surface, window, widget, scale);
      if (backdrop) (*rasters)[i].backdrop_states[state] = image;
      else (*rasters)[i].states[state] = image;
    }
    cairo_surface_destroy(surface);
  }
}
}  // namespace hive::gtk_settings
