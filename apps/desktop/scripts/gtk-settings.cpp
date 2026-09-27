#include <gtk/gtk.h>
#include <pango/pango.h>

#include <algorithm>
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

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

static std::string css_color(const GdkRGBA &color) {
  std::ostringstream out;
  out << "rgba(" << static_cast<int>(color.red * 255.0 + 0.5) << ","
      << static_cast<int>(color.green * 255.0 + 0.5) << ","
      << static_cast<int>(color.blue * 255.0 + 0.5) << ","
      << color.alpha << ")";
  return out.str();
}

static GdkRGBA context_color(GtkStyleContext *context, GtkStateFlags state, bool background) {
  GdkRGBA color = {0, 0, 0, 0};
  if (background) {
    gtk_style_context_get_background_color(context, state, &color);
  } else {
    gtk_style_context_get_color(context, state, &color);
  }
  return color;
}

static std::vector<std::string> parse_side(const std::string &side) {
  std::vector<std::string> result;
  std::stringstream input(side);
  std::string item;
  while (std::getline(input, item, ',')) {
    const auto first = item.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) continue;
    const auto last = item.find_last_not_of(" \t\r\n");
    result.push_back(item.substr(first, last - first + 1));
  }
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

struct TitleButtons {
  GtkWidget *minimize = nullptr;
  GtkWidget *maximize = nullptr;
  GtkWidget *close = nullptr;
  int spacing = 3;
  bool has_spacing = false;
};

static void collect_title_buttons(GtkWidget *widget, gpointer data);

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

struct ButtonRaster {
  int width = 0;
  int height = 0;
  std::string states[4];
};

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
                                    std::vector<ButtonRaster> *rasters) {
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
      (*rasters)[i].states[state] = crop_widget_data_uri(surface, window, widget, scale);
    }
    cairo_surface_destroy(surface);
  }
}

static std::string button_raster_json(const ButtonRaster &raster) {
  const char *state_names[] = {"normal", "hover", "active", "disabled"};
  std::string output = "{\"width\":" + std::to_string(raster.width) +
      ",\"height\":" + std::to_string(raster.height);
  for (size_t i = 0; i < 4; ++i) {
    output += "," + json_quote(state_names[i]) + ":" + json_quote(raster.states[i].c_str());
  }
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

int main(int argc, char **argv) {
  if (!gtk_init_check(&argc, &argv)) {
    emit_fallback();
    return 0;
  }

  GtkSettings *settings = gtk_settings_get_default();
  if (!settings) {
    emit_fallback();
    return 0;
  }

  gchar *theme = nullptr;
  gchar *font = nullptr;
  gchar *icons = nullptr;
  gchar *decoration_layout = nullptr;
  gboolean dark = FALSE;
  g_object_get(settings,
               "gtk-theme-name", &theme,
               "gtk-font-name", &font,
               "gtk-icon-theme-name", &icons,
               "gtk-application-prefer-dark-theme", &dark,
               "gtk-decoration-layout", &decoration_layout,
               nullptr);
  g_object_set(settings, "gtk-enable-animations", FALSE, nullptr);

  const std::string layout = decoration_layout && *decoration_layout
      ? decoration_layout
      : "menu:minimize,maximize,close";
  const auto colon = layout.find(':');
  const std::string left_text = colon == std::string::npos ? "" : layout.substr(0, colon);
  const std::string right_text = colon == std::string::npos ? layout : layout.substr(colon + 1);
  const auto left = parse_side(left_text);
  const auto right = parse_side(right_text);

  PangoFontDescription *font_description = font ? pango_font_description_from_string(font) : nullptr;
  const char *font_family = font_description ? pango_font_description_get_family(font_description) : "";

  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_title(GTK_WINDOW(window), "Hive");
  gtk_window_set_default_size(GTK_WINDOW(window), 720, 160);
  gtk_window_set_resizable(GTK_WINDOW(window), TRUE);
  gtk_window_set_deletable(GTK_WINDOW(window), TRUE);
  gtk_window_set_accept_focus(GTK_WINDOW(window), FALSE);
  gtk_window_set_skip_taskbar_hint(GTK_WINDOW(window), TRUE);
  gtk_window_set_skip_pager_hint(GTK_WINDOW(window), TRUE);
  gtk_widget_set_opacity(window, 0.0);

  GtkWidget *header = gtk_header_bar_new();
  gtk_header_bar_set_decoration_layout(GTK_HEADER_BAR(header), layout.c_str());
  gtk_header_bar_set_show_close_button(GTK_HEADER_BAR(header), TRUE);
  gtk_window_set_titlebar(GTK_WINDOW(window), header);
  gtk_window_move(GTK_WINDOW(window), -10000, -10000);
  gtk_widget_show_all(window);
  while (gtk_events_pending()) gtk_main_iteration_do(FALSE);
  gdk_display_flush(gdk_display_get_default());
  while (gtk_events_pending()) gtk_main_iteration_do(FALSE);

  TitleButtons buttons;
  collect_title_buttons(header, &buttons);
  GtkWidget *maximize_image = buttons.maximize ? find_first_image(buttons.maximize) : nullptr;

  const std::vector<std::pair<const char *, GtkWidget *>> title_widgets = {
      {"minimize", buttons.minimize},
      {"maximize", buttons.maximize},
      {"close", buttons.close},
  };
  std::vector<ButtonRaster> current_rasters(title_widgets.size());
  capture_button_variants(window, title_widgets, &current_rasters);

  ButtonRaster restore_raster;
  if (maximize_image) {
    GtkIconSize image_size = GTK_ICON_SIZE_MENU;
    if (GTK_IS_IMAGE(maximize_image)) {
      const gchar *icon_name = nullptr;
      gtk_image_get_icon_name(GTK_IMAGE(maximize_image), &icon_name, &image_size);
      if (!icon_name) image_size = GTK_ICON_SIZE_MENU;
    }
    gtk_image_set_from_icon_name(GTK_IMAGE(maximize_image), "window-restore-symbolic", image_size);
    std::vector<std::pair<const char *, GtkWidget *>> restore_widgets = {{"restore", buttons.maximize}};
    std::vector<ButtonRaster> restore_rasters(1);
    capture_button_variants(window, restore_widgets, &restore_rasters);
    restore_raster = restore_rasters.front();
  }

  GtkStyleContext *header_context = gtk_widget_get_style_context(header);
  GtkWidget *button_widget = buttons.minimize ? buttons.minimize
      : (buttons.maximize ? buttons.maximize : (buttons.close ? buttons.close : header));
  GtkStyleContext *button_context = gtk_widget_get_style_context(button_widget);
  const auto header_background = css_color(context_color(header_context, GTK_STATE_FLAG_NORMAL, true));
  const auto header_foreground = css_color(context_color(header_context, GTK_STATE_FLAG_NORMAL, false));
  const GtkStateFlags states[] = {
      GTK_STATE_FLAG_NORMAL,
      GTK_STATE_FLAG_PRELIGHT,
      static_cast<GtkStateFlags>(GTK_STATE_FLAG_PRELIGHT | GTK_STATE_FLAG_ACTIVE),
      GTK_STATE_FLAG_INSENSITIVE,
  };
  const char *state_names[] = {"normal", "hover", "active", "disabled"};
  std::string button_json = "{";
  for (size_t i = 0; i < 4; ++i) {
    if (i) button_json += ',';
    button_json += json_quote(state_names[i]) + ":{\"foreground\":" +
        json_quote(css_color(context_color(button_context, states[i], false)).c_str()) +
        ",\"background\":" +
        json_quote(css_color(context_color(button_context, states[i], true)).c_str()) + "}";
  }
  button_json += '}';

  GtkIconTheme *icon_theme = gtk_icon_theme_get_default();
  const auto menu_icon = icon_data_uri(icon_theme, button_context, "open-menu-symbolic");

  gint min_height = 0;
  gint natural_height = 0;
  gtk_widget_get_preferred_height(header, &min_height, &natural_height);
  const int header_height = std::max(1, natural_height);

  std::cout << "{\"gtk\":{\"version\":3,\"theme\":" << json_quote(theme)
            << ",\"iconTheme\":" << json_quote(icons)
            << ",\"font\":" << json_quote(font)
            << ",\"fontFamily\":" << json_quote(font_family)
            << ",\"dark\":" << (dark ? "true" : "false")
            << "},\"window\":{\"decorationLayout\":{\"layout\":" << json_quote(layout.c_str())
            << ",\"left\":" << json_array(left) << ",\"right\":" << json_array(right)
            << "}},\"icons\":{\"menu\":" << json_quote(menu_icon.c_str()) << "}"
            << ",\"titleButtons\":{\"spacing\":" << buttons.spacing
            << ",\"minimize\":" << button_raster_json(current_rasters[0])
            << ",\"maximize\":" << button_raster_json(current_rasters[1])
            << ",\"restore\":" << button_raster_json(restore_raster)
            << ",\"close\":" << button_raster_json(current_rasters[2]) << '}'
            << ",\"button\":" << button_json
            << ",\"headerbar\":{\"background\":" << json_quote(header_background.c_str())
            << ",\"foreground\":" << json_quote(header_foreground.c_str())
            << ",\"height\":" << header_height << "}}" << std::endl;

  gtk_widget_destroy(window);
  if (font_description) pango_font_description_free(font_description);
  g_free(theme);
  g_free(font);
  g_free(icons);
  g_free(decoration_layout);
  return 0;
}
