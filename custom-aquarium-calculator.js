(function (global) {
  'use strict';

  var DEFAULT_GLASS_PRICES = {
    '3mm': 85,
    '6mm': 185,
    '10mm': 290,
    '12mm': 330
  };

  var DEFAULT_STICKER_PRICES = {
    plain: 70,
    tiles: 90
  };

  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function roundNearest10(value) {
    return Math.round((Number(value) || 0) / 10) * 10;
  }

  function ceilNearest10(value) {
    return Math.ceil((Number(value) || 0) / 10) * 10;
  }

  function normalizeUnit(unit) {
    return String(unit || 'Inches').trim().toLowerCase();
  }

  function toInches(value, unit) {
    var numeric = Number(value) || 0;
    switch (normalizeUnit(unit)) {
      case 'cm':
        return numeric / 2.54;
      case 'mm':
        return numeric / 25.4;
      case 'ft':
      case 'feet':
      case 'foot':
        return numeric * 12;
      default:
        return numeric;
    }
  }

  function cubicInchesToGallons(cubicInches) {
    return cubicInches / 231;
  }

  function getGlassAreaSqFt(lengthInches, widthInches, heightInches) {
    var areaSqInches =
      (2 * (lengthInches * heightInches)) +
      (2 * (widthInches * heightInches)) +
      (lengthInches * widthInches);

    return areaSqInches / 144;
  }

  function normalizeGlass(glass) {
    var text = String(glass || '6mm').trim().toLowerCase();
    if (!text.endsWith('mm')) {
      text += 'mm';
    }
    return text;
  }

  function extractGlassMm(glass) {
    var match = String(glass || '').match(/(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  function getRequiredGlassFromMessage(message) {
    var text = String(message || '').toLowerCase();
    if (text.indexOf('12mm') >= 0) return '12mm';
    if (text.indexOf('10mm') >= 0) return '10mm';
    if (text.indexOf('6mm') >= 0) return '6mm';
    if (text.indexOf('3mm') >= 0) return '3mm';
    return null;
  }

  function buildGlassPriceLookup(rows, preferredUom) {
    var lookup = Object.assign({}, DEFAULT_GLASS_PRICES);
    var wantedUom = String(preferredUom || 'MM').trim().toLowerCase();
    var items = Array.isArray(rows) ? rows : [];

    for (var i = 0; i < items.length; i += 1) {
      var row = items[i] || {};
      var rowUom = String(row.uom || row.UOM || '').trim().toLowerCase();
      if (rowUom !== wantedUom) {
        continue;
      }

      var units = String(row.units || row.Units || '').trim();
      var price = Number(row.pricePerSqFt || row.PricePerSqFt || 0);
      if (!units || !(price > 0)) {
        continue;
      }

      lookup[normalizeGlass(units)] = price;
    }

    return lookup;
  }

  function validateGlassSafety(lengthInches, widthInches, heightInches, glassThickness, isTempered, isRimless) {
    var glass = normalizeGlass(glassThickness);
    var gallons = cubicInchesToGallons(lengthInches * widthInches * heightInches);
    var glassMm = extractGlassMm(glass);

    if (glass === '3mm' && lengthInches > 24) {
      return {
        isSafe: false,
        message: 'Length exceeds 24 inches for 3mm glass. Auto-upgrading glass to 6mm.',
        autoChangeTo: '6mm'
      };
    }

    if ((widthInches >= 36 || heightInches >= 36) && !isTempered) {
      return {
        isSafe: false,
        message: 'Width or height is 36 inches or more. Tempered glass is mandatory for this custom aquarium.',
        autoChangeTo: null
      };
    }

    if (glass === '3mm') {
      if (gallons > 15 && (lengthInches > 24 || widthInches > 12 || heightInches > 12)) {
        return {
          isSafe: false,
          message: 'Tank exceeds safe limits for 3mm glass. Please select 10mm or 12mm glass.',
          autoChangeTo: null
        };
      }
    }

    if (lengthInches > 60 || widthInches > 20 || heightInches > 20) {
      if (glass === '3mm' || (glass === '6mm' && gallons > 50)) {
        return {
          isSafe: false,
          message: 'Tank dimensions exceed safe limits for selected glass. Please choose 10mm or 12mm glass.',
          autoChangeTo: null
        };
      }
    }

    if (glass === '10mm') {
      if (gallons > 180 || lengthInches > 72 || widthInches > 30 || heightInches > 30) {
        return {
          isSafe: false,
          message: 'Tank volume or dimensions require 12mm glass. Please select 12mm glass to calculate.',
          autoChangeTo: null
        };
      }
    }

    if (isRimless) {
      if (gallons >= 10 && gallons <= 15 && glassMm < 6) {
        return {
          isSafe: false,
          message: 'Rimless 10-15G tanks require minimum 6mm glass.',
          autoChangeTo: null
        };
      }

      if (gallons >= 30 && gallons <= 100 && glassMm < 10) {
        return {
          isSafe: false,
          message: 'Rimless 30-100G tanks require minimum 10mm glass.',
          autoChangeTo: null
        };
      }
    }

    return {
      isSafe: true,
      message: 'OK',
      autoChangeTo: null
    };
  }

  function calculateStickerPrice(panelLengthInches, panelWidthInches, pricePerSqFt) {
    if (panelLengthInches <= 0 || panelWidthInches <= 0 || pricePerSqFt <= 0) {
      return 0;
    }

    var areaSqFt = (panelLengthInches / 12) * (panelWidthInches / 12);
    return ceilNearest10(areaSqFt * pricePerSqFt);
  }

  function getStickerRate(stickerType, config) {
    var type = String(stickerType || 'plain').trim().toLowerCase();
    var stickerRates = Object.assign({}, DEFAULT_STICKER_PRICES, config && config.stickerPricesPerSqFt);
    return type === 'tiles' ? Number(stickerRates.tiles) || 0 : Number(stickerRates.plain) || 0;
  }

  function calculateCustomAquarium(input) {
    var options = input || {};
    var unit = options.unit || 'Inches';
    var optionType = String(options.option || 'Aquarium only');
    var requestedGlass = normalizeGlass(options.glassThickness || '6mm');
    var requestedTempered = Boolean(options.temperedGlass);
    var glass = requestedGlass;
    var isTempered = requestedTempered;
    var isLowIron = Boolean(options.lowIron);
    var isAio = Boolean(options.aio);
    var isRimless = Boolean(options.rimless);
    var hasHighStrip = Boolean(options.highStrip);
    var hasAquascapeService = Boolean(options.aquascapeService);
    var hasEnclosure = Boolean(options.enclosure);
    var hasStand = Boolean(options.stand && options.stand.enabled && Number(options.stand.price) > 0);
    var hasFiltrationSump = Boolean(
      (options.filtrationSump && options.filtrationSump.enabled) ||
      String(optionType).toLowerCase() === 'complete setup'
    );
    var lengthInches = toInches(options.length, unit);
    var widthInches = toInches(options.width, unit);
    var heightInches = toInches(options.height, unit);
    var safetyNotice = null;

    if (!(lengthInches > 0) || !(widthInches > 0) || !(heightInches > 0)) {
      return {
        ok: false,
        error: 'Please enter valid positive dimensions.',
        autoChangeTo: null
      };
    }

    if (isLowIron) {
      isTempered = true;
    }

    if ((widthInches >= 36 || heightInches >= 36) && !isTempered) {
      isTempered = true;
    }

    if (isAio && hasFiltrationSump) {
      return {
        ok: false,
        error: 'AIO cannot be combined with filtration sump.',
        autoChangeTo: null
      };
    }

    if (isAio && hasEnclosure) {
      return {
        ok: false,
        error: 'AIO and enclosure cannot both be selected.',
        autoChangeTo: null
      };
    }

    if (hasFiltrationSump && hasEnclosure) {
      return {
        ok: false,
        error: 'Enclosure cannot be selected when filtration sump is enabled.',
        autoChangeTo: null
      };
    }

    if (isAio && extractGlassMm(glass) === 3) {
      glass = '6mm';
    }

    if (isLowIron && isTempered && extractGlassMm(glass) < 10) {
      glass = '10mm';
    }

    var safety = validateGlassSafety(lengthInches, widthInches, heightInches, glass, isTempered, isRimless);
    if (safety.autoChangeTo) {
      safetyNotice = {
        title: 'Glass Auto-upgrade',
        message: safety.message,
        updatedGlassThickness: safety.autoChangeTo
      };
      glass = safety.autoChangeTo;
      safety = validateGlassSafety(lengthInches, widthInches, heightInches, glass, isTempered, isRimless);
    }

    if (!safety.isSafe) {
      var requiredGlass = getRequiredGlassFromMessage(safety.message);
      if (requiredGlass && requiredGlass !== glass) {
        var originalSafetyMessage = safety.message;
        glass = requiredGlass;
        if (String(safety.message || '').toLowerCase().indexOf('tempered 12mm') >= 0) {
          isTempered = true;
        }
        safetyNotice = {
          title: 'Glass Auto-upgrade',
          message: originalSafetyMessage + '\n\nGlass thickness has been updated to ' + requiredGlass + '.',
          updatedGlassThickness: requiredGlass
        };
        safety = validateGlassSafety(lengthInches, widthInches, heightInches, glass, isTempered, isRimless);
      }
    }

    if (!safety.isSafe) {
      return {
        ok: false,
        error: safety.message,
        autoChangeTo: getRequiredGlassFromMessage(safety.message) || safety.autoChangeTo || null,
        requested: {
          glassThickness: requestedGlass,
          temperedGlass: requestedTempered
        },
        normalized: {
          glassThickness: glass,
          temperedGlass: isTempered
        },
        safetyNotice: safetyNotice
      };
    }

    var gallons = cubicInchesToGallons(lengthInches * widthInches * heightInches);
    var glassPrices = Object.assign(
      {},
      buildGlassPriceLookup(options.glassPricingSetupRows, options.glassPricingUom || 'MM'),
      options.glassPricesPerSqFt
    );
    var basePricePerSqFt = Number(glassPrices[glass]) || 100;
    var finalPricePerSqFt = basePricePerSqFt;
    var glassAreaSqFt = getGlassAreaSqFt(lengthInches, widthInches, heightInches);
    var components = {
      glass: 0,
      highStrip: 0,
      sumpGlass: 0,
      filterMedia: 0,
      overflowBox: 0,
      light: 0,
      pump: 0,
      piping: 0,
      allumTopCover: 0,
      stickerBackground: 0,
      stickerBottom: 0,
      aquascapeService: 0,
      stand: hasStand ? Number(options.stand.price) || 0 : 0
    };

    if (gallons < 90 && glass === '6mm') {
      finalPricePerSqFt = 117;
    } else if (gallons >= 300 && glass === '12mm') {
      finalPricePerSqFt += 145;
    } else if (gallons >= 170 && glass === '12mm') {
      finalPricePerSqFt += 110;
    }

    if (isTempered) {
      finalPricePerSqFt *= 2;
    }

    var calculatedPrice = glassAreaSqFt * finalPricePerSqFt;
    components.glass = round2(calculatedPrice);

    if (hasHighStrip) {
      var highStripLinearFeet = ((lengthInches + widthInches) * 2) / 12;
      components.highStrip = round2(highStripLinearFeet * 90);
      calculatedPrice += components.highStrip;
    }

    var normalizedSump = null;
    if (hasFiltrationSump) {
      var sump = options.filtrationSump || {};
      var sumpUnit = sump.unit || unit;
      var sumpType = String(sump.type || 'Undersump');
      var sumpLengthInches = toInches(sump.length, sumpUnit);
      var sumpWidthInches = toInches(sump.width, sumpUnit);
      var sumpHeightInches = toInches(sump.height, sumpUnit);

      normalizedSump = {
        type: sumpType,
        unit: sumpUnit,
        lengthInches: sumpLengthInches,
        widthInches: sumpWidthInches,
        heightInches: sumpHeightInches
      };

      if (sumpLengthInches > 0 && sumpWidthInches > 0 && sumpHeightInches > 0) {
        var sumpAreaSqFt = getGlassAreaSqFt(sumpLengthInches, sumpWidthInches, sumpHeightInches);
        var sumpPricePerSqFt = basePricePerSqFt;
        if (isTempered) {
          sumpPricePerSqFt *= 2;
        }

        components.sumpGlass = round2(sumpAreaSqFt * sumpPricePerSqFt);
        calculatedPrice += components.sumpGlass;

        if (sump.filterMedias) {
          var volumeCuFt = (sumpLengthInches / 12) * (sumpWidthInches / 12) * (sumpHeightInches / 12);
          var liters = volumeCuFt * 28.316;
          var fillRatio = String(sumpType).toLowerCase() === 'overhead sump' ? 0.18 : 0.04;
          var mediaKg = Math.round(liters * fillRatio);
          components.filterMedia = round2(mediaKg * 300);
          calculatedPrice += components.filterMedia;
          normalizedSump.filterMediaKg = mediaKg;
          normalizedSump.meshBags = mediaKg;
          normalizedSump.filterWools = mediaKg;
        }

        if (sump.overflowBox) {
          components.overflowBox = 1900;
          calculatedPrice += components.overflowBox;
        }

        if (sump.lightPrice) {
          components.light = round2(Number(sump.lightPrice) || 0);
          calculatedPrice += components.light;
        }

        if (sump.pumpPrice) {
          components.pump = round2(Number(sump.pumpPrice) || 0);
          calculatedPrice += components.pump;
        }

        if (sump.piping) {
          components.piping = String(sumpType).toLowerCase() === 'overhead sump' ? 450 : 2200;
        }

        if (sump.allumTopCover) {
          var effectiveWidthInches = widthInches;
          if (String(sumpType).toLowerCase() === 'overhead sump') {
            effectiveWidthInches = Math.max(0, widthInches - sumpWidthInches);
          }
          var coverAreaSqFt = (lengthInches / 12) * (effectiveWidthInches / 12);
          components.allumTopCover = ceilNearest10(coverAreaSqFt * 500);
        }
      }
    }

    var stickerBackground = options.stickerBackground || {};
    if (stickerBackground.enabled) {
      var backgroundRate = getStickerRate(stickerBackground.type, options);
      components.stickerBackground = calculateStickerPrice(lengthInches, heightInches, backgroundRate);
      if (stickerBackground.allSides) {
        components.stickerBackground += calculateStickerPrice(widthInches, heightInches, backgroundRate) * 2;
      }
    }

    var stickerBottom = options.stickerBottom || {};
    if (stickerBottom.enabled) {
      var bottomRate = getStickerRate(stickerBottom.type, options);
      components.stickerBottom = calculateStickerPrice(lengthInches, widthInches, bottomRate);
    }

    if (String(optionType).toLowerCase() === 'undersump' ||
        String(optionType).toLowerCase() === 'overheadsump' ||
        String(optionType).toLowerCase() === 'overhead sump') {
      calculatedPrice = round2(calculatedPrice * 1.9);
    }

    if (isAio) {
      calculatedPrice = round2(calculatedPrice * 2.4);
    }

    if (isLowIron) {
      calculatedPrice = round2(calculatedPrice * 1.7);
    }

    if (calculatedPrice >= 1000) {
      calculatedPrice = roundNearest10(calculatedPrice);
    }

    if (components.piping > 0) {
      calculatedPrice += components.piping;
    }

    if (components.allumTopCover > 0) {
      calculatedPrice += components.allumTopCover;
    }

    if (components.stickerBackground > 0) {
      calculatedPrice += components.stickerBackground;
    }

    if (components.stickerBottom > 0) {
      calculatedPrice += components.stickerBottom;
    }

    if (hasAquascapeService) {
      components.aquascapeService = Math.round(gallons * 210);
      calculatedPrice += components.aquascapeService;
    }

    if (hasEnclosure) {
      calculatedPrice = round2(calculatedPrice * 2.1);
      if (calculatedPrice >= 1000) {
        calculatedPrice = roundNearest10(calculatedPrice);
      }
    }

    var aquariumOnlyPrice = calculatedPrice;

    if (hasStand) {
      calculatedPrice += components.stand;
    }

    return {
      ok: true,
      totalPrice: round2(calculatedPrice),
      aquariumOnlyPrice: round2(aquariumOnlyPrice),
      gallons: round2(gallons),
      components: components,
      requested: {
        glassThickness: requestedGlass,
        temperedGlass: requestedTempered
      },
      normalized: {
        unit: unit,
        option: optionType,
        glassThickness: glass,
        temperedGlass: isTempered,
        rimless: isRimless,
        lengthInches: round2(lengthInches),
        widthInches: round2(widthInches),
        heightInches: round2(heightInches),
        sump: normalizedSump
      },
      safety: safety,
      safetyNotice: safetyNotice
    };
  }

  var api = {
    buildGlassPriceLookup: buildGlassPriceLookup,
    calculateCustomAquarium: calculateCustomAquarium,
    validateGlassSafety: validateGlassSafety,
    toInches: toInches
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  global.CustomAquariumCalculator = api;
})(typeof window !== 'undefined' ? window : globalThis);