import pandas as pd
import pycountry

def country_to_flag(country_name):
    """
    Convert country name to flag emoji.
    Tries pycountry first, then fallback to simple map.
    """
    try:
        if pd.isna(country_name) or str(country_name).strip() == "":
            return ""
        
        # Try pycountry first for robust lookup
        try:
            country = pycountry.countries.lookup(str(country_name))
            code = country.alpha_2
            # Convert alpha-2 code to flag emoji
            return chr(ord(code[0].upper()) + 127397) + chr(ord(code[1].upper()) + 127397)
        except Exception:
            pass
        
        # Fallback: try extract 2-letter code if given
        cc = str(country_name).strip()
        if len(cc) == 2 and cc.isalpha():
            code = cc.upper()
            return chr(ord(code[0]) + 127397) + chr(ord(code[1]) + 127397)
        
        # Last fallback: simple name-based map for common countries
        simple_map = {
            "UK": "🇬🇧", "United Kingdom": "🇬🇧", "Gibraltar": "🇬🇮", 
            "Romania": "🇷🇴", "Bulgaria": "🇧🇬", "Israel": "🇮🇱", 
            "Poland": "🇵🇱", "Malta": "🇲🇹", "Italy": "🇮🇹", 
            "Czech Republic": "🇨🇿", "Sweden": "🇸🇪", "India": "🇮🇳", 
            "Georgia": "🇬🇪", "Ukraine": "🇺🇦", "USA": "🇺🇸", 
            "United States": "🇺🇸", "Ireland": "🇮🇪", "Spain": "🇪🇸", 
            "Philippines": "🇵🇭"
        }
        return simple_map.get(country_name, "")
    except Exception:
        return ""

def build_country_flag(df, country_col=None):
    """
    Add Country_Flag column based on specified country column.
    
    Args:
        df: DataFrame
        country_col: Name of the column containing country data (default: "Country")
    
    Returns:
        DataFrame with Country_Flag column added
    """
    # If no column specified, try to find "Country" column
    if country_col is None:
        country_col = "Country"
    
    # Generate flags if the specified column exists
    if country_col and country_col in df.columns:
        df["Country_Flag"] = df[country_col].apply(country_to_flag)
        print(f"✅ Country flags generated from column: {country_col}")
    else:
        df["Country_Flag"] = ""
        if country_col:
            print(f"⚠️ Country column '{country_col}' not found, Country_Flag set to empty")
    
    return df

def apply_exclusion_filter(df, remove=True):
    """
    Removes rows where exclusion list = 1.
    
    Args:
        df: DataFrame
        remove: Whether to remove exclusion rows (default: True)
    
    Returns:
        Tuple of (filtered_df, removed_count)
    """
    if "exclusion list" not in df.columns:
        return df, 0
    if not remove:
        return df, 0
    
    removed = df[df["exclusion list"] == 1].shape[0]
    df_new = df[df["exclusion list"] != 1].copy()
    
    return df_new, removed