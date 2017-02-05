import argparse
import datetime as dt
import urllib
from bs4 import BeautifulSoup as bs

pattern = 'https://biz.yahoo.com/research/earncal/{}.html'


def date_to_str(date):
	return date.strftime('%Y%m%d')


def date_strings(from_offset, to_offset):
	today = dt.date.today()
	ret = []
	for off in xrange(from_offset, to_offset):
		date = today + dt.timedelta(days=off)
		ret.append((date.strftime('%Y%m%d'), 1000 * int(date.strftime('%s'))))
	return ret


def earning_calendar_for_date(date, ms_from_epoch):
	url = pattern.format(date)
	print url
	html = ''
	try:
		html = urllib.request.urlopen(url).read()
	except Exception:
		html = urllib.urlopen(url).read()
	soup = bs(html, 'html.parser')
	trs = []
	for tr in soup.find_all('tr'):
		trs.extend(tr.find_all('tr'))
		trs.append(tr)
	ret = []
	for tr in trs:
		tds = tr.find_all('td')
		if (len(tds) < 2):
			continue
		symbol = tds[1]
		all_good = False
		yahoo_url_start = 'http://finance.yahoo.com/q?s='
		if (symbol.find('a') and symbol.find('a').attrs['href'].startswith(yahoo_url_start)):
			all_good = True
		if not all_good:
			continue
		name, ticker = tds[0].text, tds[1].text
	 	ret.append((name, ticker, ms_from_epoch))
	return ret


def fetch_earnings_calendar(dates):
	ret = []
	for date in dates:
		ret.extend(earning_calendar_for_date(date[0], date[1]))
	return ret


def write_to_db(db_path, data):
	if len(data) == 0:
		print "Why Why Why"
		return
	import sqlite3
	conn = sqlite3.connect(db_path)
	c = conn.cursor()
	query = 'INSERT INTO EarningDates(ticker, date) VALUES '
	inss = []
	for d in data:
		inss.append("('{}', {})".format(d[1], d[2]))
	c.execute(query + ','.join(inss))
	conn.commit()
	conn.close()


def main():
	parser = argparse.ArgumentParser(description='Save Earning Dates')
	parser.add_argument('-db', help='Path to sqlite',
	                    dest='db', required=True)
	parser.add_argument('-t', help='To', dest='to_off', required=True, type=int)
	parser.add_argument('-f', help='From', dest='from_off',
	                    required=True, type=int)
	args = parser.parse_args()
	earnings = fetch_earnings_calendar(date_strings(args.from_off, args.to_off))
	write_to_db(args.db, earnings)


main()
