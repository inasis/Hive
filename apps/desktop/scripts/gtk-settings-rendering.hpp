#pragma once

#include <gtk/gtk.h>

#include <algorithm>
#include <sstream>
#include <string>

namespace hive::gtk_settings {
// GTK helpers for sampling colors and icons from the active desktop theme.
static std::string css_color(const GdkRGBA &color) {
  std::ostringstream out;
  out << "rgba(" << static_cast<int>(color.red * 255.0 + 0.5) << ","
      << static_cast<int>(color.green * 255.0 + 0.5) << ","
      << static_cast<int>(color.blue * 255.0 + 0.5) << ","
      << color.alpha << ")";
  return out.str();
}

static GdkRGBA context_color(GtkStyleContext *context,
                             GtkStateFlags state,
                             bool background,
                             int width = 1,
                             int height = 1) {
  GdkRGBA color = {0, 0, 0, 0};
  if (background) {
    width = std::max(1, width);
    height = std::max(1, height);
    gtk_style_context_save(context);
    gtk_style_context_set_state(context, state);
    cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, width, height);
    cairo_t *cr = cairo_create(surface);
    gtk_render_background(context, cr, 0, 0, width, height);
    cairo_destroy(cr);
    cairo_surface_flush(surface);

    GdkPixbuf *pixel = gdk_pixbuf_get_from_surface(surface, width / 2, height / 2, 1, 1);
    cairo_surface_destroy(surface);
    gtk_style_context_restore(context);
    if (pixel) {
      const guchar *channels = gdk_pixbuf_get_pixels(pixel);
      const int channel_count = gdk_pixbuf_get_n_channels(pixel);
      color.red = channels[0] / 255.0;
      color.green = channels[1] / 255.0;
      color.blue = channels[2] / 255.0;
      color.alpha = channel_count >= 4 ? channels[3] / 255.0 : 1.0;
      g_object_unref(pixel);
    }
    return color;
  }

  gtk_style_context_get_color(context, state, &color);
  return color;
}

static std::string pixbuf_data_uri(GdkPixbuf *pixbuf) {
  if (!pixbuf) return "";
  gchar *png = nullptr;
  gsize png_size = 0;
  GError *error = nullptr;
  if (!gdk_pixbuf_save_to_buffer(pixbuf, &png, &png_size, "png", &error, nullptr)) {
    if (error) g_error_free(error);
    return "";
  }
  gchar *base64 = g_base64_encode(reinterpret_cast<const guchar *>(png), png_size);
  const std::string result = std::string("data:image/png;base64,") + base64;
  g_free(base64);
  g_free(png);
  return result;
}

static std::string icon_data_uri(GtkIconTheme *theme, GtkStyleContext *context, const char *name) {
  if (!theme) return "";
  GtkIconInfo *info = gtk_icon_theme_lookup_icon(theme, name, 32, GTK_ICON_LOOKUP_FORCE_SIZE);
  if (!info) return "";

  GError *error = nullptr;
  gboolean symbolic = FALSE;
  GdkPixbuf *pixbuf = gtk_icon_info_load_symbolic_for_context(info, context, &symbolic, &error);
  if (!pixbuf && error) g_clear_error(&error);
  if (!pixbuf) pixbuf = gtk_icon_info_load_icon(info, &error);
  g_object_unref(info);
  if (!pixbuf) {
    if (error) g_error_free(error);
    return "";
  }

  const std::string result = pixbuf_data_uri(pixbuf);
  g_object_unref(pixbuf);
  return result;
}
}  // namespace hive::gtk_settings
